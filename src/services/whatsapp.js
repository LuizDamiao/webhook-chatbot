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
        }
      });

      this.sock.ev.on('chats.upsert', (chats) => {
        for (const chat of chats) {
          if (chat.id?.includes('@g.us')) continue;
          if (!this._loadedChats) this._loadedChats = new Set();
          if (this._loadedChats.has(chat.id)) continue;
          this._loadedChats.add(chat.id);
          this.loadMessagesFromChat(chat.id, chat.name).catch(err =>
            logger.warn(`Failed to load chat ${chat.id}:`, err.message)
          );
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
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text ||
                       msg.message?.buttonsResponseMessage?.selectedButtonId || '';
          if (!phone || !text) continue;

          let quotedText = null;
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          if (ctx?.quotedMessage) {
            quotedText = ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text || null;
          }

          const stored = messageStore.add({
            from: fromMe ? 'bot' : (jid || phone),
            to: fromMe ? (jid || phone) : 'bot',
            body: text,
            direction: fromMe ? 'outgoing' : 'incoming',
            status: 'received',
            customerName: msg.pushName || phone,
            quotedText,
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
          if (status == null) continue;
          const statusMap = { 0: 'error', 1: 'pending', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'played', 16: 'sent' };
          const statusText = statusMap[status] || `status_${status}`;
          const msgId = update.key?.id;
          if (msgId) {
            const msg = messageStore.messages.find(m => m.id === msgId);
            if (msg) {
              msg.status = statusText;
              logger.info(`Message ${msgId} status: ${statusText}`);
            }
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
   * Load messages from a specific chat (last 7 days)
   */
  async loadMessagesFromChat(chatId, chatName) {
    if (!this.sock) return;

    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    try {
      const history = await this.sock.loadMessages(chatId, 50);
      if (!history?.messages) return;

      let loaded = 0;
      for (const msg of history.messages) {
        if (!msg.message) continue;
        const ts = msg.messageTimestamp ?
          (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : new Date(msg.messageTimestamp).getTime()) : 0;
        if (ts < sevenDaysAgo) continue;

        const fromMe = msg.key?.fromMe;
        const phone = chatId.replace('@s.whatsapp.net', '').replace('@lid', '');
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text ||
                     msg.message?.buttonsResponseMessage?.selectedButtonId || '';
        if (!text) continue;

        let quotedText = null;
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        if (ctx?.quotedMessage) {
          quotedText = ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text || null;
        }

        messageStore.add({
          from: fromMe ? 'bot' : chatId,
          to: fromMe ? chatId : 'bot',
          body: text,
          direction: fromMe ? 'outgoing' : 'incoming',
          status: 'synced',
          customerName: chatName || phone,
          quotedText,
          timestamp: new Date(ts).toISOString()
        });
        loaded++;
      }
      logger.info(`[HISTORY] ${chatId} (${chatName || phone}): ${loaded} messages loaded`);
    } catch (err) {
      logger.warn(`Failed to load history for ${chatId}:`, err.message);
    }
  }

  /**
   * Send text message
   * @param {string} phone - Phone number (will be formatted)
   * @param {string} message - Message text
   * @returns {boolean} Success status
   */
  async sendMessage(phone, message, options = {}) {
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
      const payload = { text: message };
      if (options.quoted) {
        payload.quoted = { key: { remoteJid: jid, id: options.quoted, fromMe: false } };
      }
      const result = await this.sock.sendMessage(jid, payload);
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
