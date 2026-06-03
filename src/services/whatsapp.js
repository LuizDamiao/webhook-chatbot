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
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          logger.info('Connection closed:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
          this.isConnected = false;

          if (shouldReconnect) {
            this.connect();
          }
        } else if (connection === 'open') {
          logger.info('WhatsApp connected');
          this.isConnected = true;
        }
      });
    } catch (error) {
      logger.error('Failed to initialize WhatsApp:', error);
      throw error;
    }
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
      await this.sock.sendMessage(jid, { text: message });
      logger.info(`Message sent to ${formattedPhone}`);
      return { success: true };
    } catch (error) {
      logger.error('Failed to send message:', error);
      return { success: false, error: error.message };
    }
  }
}
