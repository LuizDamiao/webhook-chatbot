import pino from 'pino';

const logger = pino({ level: 'info' });

/**
 * Formats phone number to WhatsApp format
 * @param {string} phone - Phone number
 * @returns {string} Formatted phone with country code
 */
export function formatPhone(phone) {
  if (!phone) throw new Error('Invalid phone number');

  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length < 10 || cleaned.length > 13) {
    throw new Error('Invalid phone number');
  }

  if (cleaned.startsWith('55')) {
    return cleaned;
  }
  return `55${cleaned}`;
}

/**
 * WhatsApp service using Baileys
 */
export class WhatsAppService {
  constructor(sessionDir) {
    this.sessionDir = sessionDir || './auth_info';
    this.sock = null;
    this.isConnected = false;
    this.qrCode = null;
    this.pairingCode = null;
  }

  /**
   * Initialize WhatsApp connection
   */
  async connect() {
    try {
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: logger
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          logger.info('QR Code received');
        }

        if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          logger.info('Connection closed:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
          this.isConnected = false;
          this.qrCode = null;
          this.pairingCode = null;

          if (shouldReconnect) {
            this.connect();
          }
        } else if (connection === 'open') {
          logger.info('WhatsApp connected');
          this.isConnected = true;
          this.qrCode = null;
          this.pairingCode = null;
        }
      });

      this.sock.ev.on('messages.update', (updates) => {
        for (const update of updates) {
          const status = update.update?.status;
          if (status) {
            const statusMap = {
              0: 'ERROR',
              1: 'PENDING',
              2: 'SERVER_ACK',
              3: 'DELIVERY_ACK',
              4: 'READ',
              5: 'PLAYED',
              16: 'SENT'
            };
            const statusText = statusMap[status] || `STATUS_${status}`;
            logger.info(`Message ${update.key?.id} status: ${statusText} (${status})`);
          }
        }
      });
    } catch (error) {
      logger.error('Failed to initialize WhatsApp:', error);
      throw error;
    }
  }

  /**
   * Get QR code for WhatsApp connection
   * @returns {string|null} QR code data
   */
  getQRCode() {
    return this.qrCode;
  }

  /**
   * Request phone pairing code (alternative to QR)
   * @param {string} phoneNumber - Phone number to pair with
   * @returns {string} Pairing code
   */
  async requestPairingCode(phoneNumber) {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp not connected');
    }
    const formattedPhone = formatPhone(phoneNumber);
    try {
      const code = await this.sock.requestPairingCode(formattedPhone);
      this.pairingCode = code;
      logger.info('Pairing code requested:', code);
      return code;
    } catch (error) {
      logger.error('Failed to request pairing code:', error);
      throw error;
    }
  }

  getPairingCode() {
    return this.pairingCode;
  }

  /**
   * Send text message
   * @param {string} phone - Phone number (will be formatted)
   * @param {string} message - Message text
   * @returns {boolean} Success status
   */
  async sendMessage(phone, message) {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp not connected');
    }

    const formattedPhone = formatPhone(phone);
    const jid = `${formattedPhone}@s.whatsapp.net`;

    try {
      const [exists] = await this.sock.onWhatsApp(jid);
      if (!exists?.exists) {
        logger.warn(`Phone ${formattedPhone} does not exist on WhatsApp`);
        return { success: false, error: 'Phone number not found on WhatsApp' };
      }
      logger.info(`Phone ${formattedPhone} verified on WhatsApp`);
    } catch (checkErr) {
      logger.warn('onWhatsApp check failed, proceeding anyway:', checkErr.message);
    }

    try {
      const result = await this.sock.sendMessage(jid, { text: message });
      logger.info(`Message sent to ${formattedPhone}`, {
        messageId: result?.key?.id,
        remoteJid: result?.key?.remoteJid,
        fromMe: result?.key?.fromMe,
        status: result?.status,
        messageTimestamp: result?.messageTimestamp,
        update: result?.update
      });
      return { success: true, messageId: result?.key?.id, remoteJid: result?.key?.remoteJid };
    } catch (error) {
      logger.error('Failed to send message:', error);
      return { success: false, error: error.message };
    }
  }
}
