import pino from 'pino';
import { messageStore } from './messageStore.js';

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
          this.loadChatHistory().catch(err => logger.error('Failed to load chat history:', err.message));
        }
      });

      this.sock.ev.on('messages.upsert', (event) => {
        const { messages, type } = event;
        if (type !== 'notify') return;
        for (const msg of messages) {
          const fromMe = msg.key.fromMe;
          const rawJid = msg.key.remoteJid || '';
          let phone = msg.key.participant?.replace('@s.whatsapp.net', '')?.replace('@lid', '') ||
                      rawJid.replace('@s.whatsapp.net', '').replace('@lid', '') || '';
          const jid = rawJid.includes('@lid') ? rawJid : (phone ? `${phone}@s.whatsapp.net` : '');
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.buttonsResponseMessage?.selectedButtonId || '';
          if (!phone || !text) continue;
          const stored = messageStore.add({
            from: fromMe ? 'bot' : (jid || phone),
            to: fromMe ? (jid || phone) : 'bot',
            body: text,
            direction: fromMe ? 'outgoing' : 'incoming',
            status: 'received',
            customerName: msg.pushName || phone,
            timestamp: msg.messageTimestamp ?
              (typeof msg.messageTimestamp === 'number' ? new Date(msg.messageTimestamp * 1000).toISOString() : msg.messageTimestamp) :
              undefined
          });
          logger.info(`[${fromMe ? 'OUTGOING' : 'INCOMING'}] from=${fromMe ? 'bot' : (jid || phone)}, text=${text.substring(0, 50)}, id=${stored.id}`);
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
   * Load existing chat history from WhatsApp store after connection
   */
  async loadChatHistory() {
    if (!this.sock) return;

    const store = this.sock.store;
    if (!store?.chats) {
      logger.info('No chat store available, skipping history load');
      return;
    }

    const chats = store.chats.all();
    logger.info(`Loading history from ${chats.length} chats`);

    let loaded = 0;
    for (const chat of chats) {
      if (chat.id?.includes('@g.us')) continue;

      try {
        const history = await this.sock.loadMessages(chat.id, 30);
        if (!history?.messages) continue;

        for (const msg of history.messages) {
          if (!msg.message) continue;
          const fromMe = msg.key?.fromMe;
          const jid = msg.key?.remoteJid || chat.id;
          const phone = jid.replace('@s.whatsapp.net', '').replace('@lid', '');
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text ||
                       msg.message?.buttonsResponseMessage?.selectedButtonId || '';
          if (!text) continue;

          const timestamp = msg.messageTimestamp ?
            (typeof msg.messageTimestamp === 'number' ? new Date(msg.messageTimestamp * 1000) : new Date(msg.messageTimestamp)) :
            new Date();

          messageStore.add({
            from: fromMe ? 'bot' : (jid || phone),
            to: fromMe ? (jid || phone) : 'bot',
            body: text,
            direction: fromMe ? 'outgoing' : 'incoming',
            status: 'synced',
            customerName: chat.name || phone,
            timestamp: timestamp.toISOString()
          });
        }
        loaded++;
      } catch (err) {
        logger.warn(`Failed to load history for ${chat.id}:`, err.message);
      }
    }

    logger.info(`Chat history loaded from ${loaded}/${chats.length} chats, total messages: ${messageStore.count}`);
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

    let jid;
    if (phone.includes('@')) {
      jid = phone;
    } else {
      const formattedPhone = formatPhone(phone);
      jid = `${formattedPhone}@s.whatsapp.net`;
      try {
        const [exists] = await this.sock.onWhatsApp(jid);
        if (!exists?.exists) {
          logger.warn(`Phone ${phone} does not exist on WhatsApp`);
          return { success: false, error: 'Phone number not found on WhatsApp' };
        }
        if (exists.jid && exists.jid !== jid) {
          logger.info(`Canonical JID differs: input=${jid} canonical=${exists.jid}`);
          jid = exists.jid;
        }
        logger.info(`Phone ${phone} verified on WhatsApp, using JID: ${jid}`);
      } catch (checkErr) {
        logger.warn('onWhatsApp check failed, proceeding anyway:', checkErr.message);
      }
    }

    try {
      const result = await this.sock.sendMessage(jid, { text: message });
      logger.info(`Message sent to ${jid}`, {
        messageId: result?.key?.id,
        remoteJid: result?.key?.remoteJid,
        fromMe: result?.key?.fromMe,
        status: result?.status,
        messageTimestamp: result?.messageTimestamp
      });
      return { success: true, messageId: result?.key?.id, remoteJid: result?.key?.remoteJid };
    } catch (error) {
      logger.error('Failed to send message:', error);
      return { success: false, error: error.message };
    }
  }
}
