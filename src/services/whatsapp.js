import pino from 'pino';
import { messageStore } from './messageStore.js';

const logger = pino({ level: 'info' });

export function formatPhone(phone) {
  if (!phone) throw new Error('Invalid phone number');
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 10 || cleaned.length > 13) throw new Error('Invalid phone number');
  return cleaned.startsWith('55') ? cleaned : `55${cleaned}`;
}

export class WhatsAppService {
  constructor(sessionDir) {
    this.sessionDir = sessionDir || './auth_info';
    this.sock = null;
    this.isConnected = false;
    this.qrCode = null;
    this.pairingCode = null;
    this._loadedChats = new Set();
    this._reconnectTimer = null;
  }

  async connect() {
    try {
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = await import('@whiskeysockets/baileys');
      this._delay = delay;
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: logger,
        browser: ['ChatBot Webhook', 'Chrome', '4.0.0']
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          logger.info('QR Code received');
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          logger.info(`Connection closed (code: ${statusCode}), reconnecting: ${shouldReconnect}`);
          this.isConnected = false;
          this.qrCode = null;
          this.pairingCode = null;

          if (shouldReconnect) {
            if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
            this._reconnectTimer = setTimeout(() => this.connect(), 3000);
          }
        } else if (connection === 'open') {
          logger.info('WhatsApp connected');
          this.isConnected = true;
          this.qrCode = null;
          this.pairingCode = null;
          this._loadedChats.clear();
          // Auto-load history after connection stabilizes
          setTimeout(() => this._autoLoadHistory(), 5000);
        }
      });

      this.sock.ev.on('chats.upsert', (chats) => {
        for (const chat of chats) {
          if (chat.id?.includes('@g.us')) continue;
          if (this._loadedChats.has(chat.id)) continue;
          this._loadedChats.add(chat.id);
          this.loadMessagesFromChat(chat.id, chat.name).catch(err =>
            logger.warn(`Failed to load chat ${chat.id}:`, err.message)
          );
        }
      });

      this.sock.ev.on('messages.upsert', (event) => {
        try {
          const { messages, type } = event;
          if (type !== 'notify') return;
          for (const msg of messages) {
            this._processMessage(msg);
          }
        } catch (err) {
          logger.error('Error processing message:', err);
        }
      });

      this.sock.ev.on('messages.update', (updates) => {
        for (const update of updates) {
          try {
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
          } catch (err) {
            logger.error('Error updating message status:', err);
          }
        }
      });
    } catch (error) {
      logger.error('Failed to initialize WhatsApp:', error);
      throw error;
    }
  }

  _processMessage(msg) {
    const fromMe = msg.key.fromMe;
    const rawJid = msg.key.remoteJid || '';
    let phone = msg.key.participant?.replace('@s.whatsapp.net', '')?.replace('@lid', '') ||
                rawJid.replace('@s.whatsapp.net', '').replace('@lid', '') || '';
    const jid = rawJid.includes('@lid') ? rawJid : (phone ? `${phone}@s.whatsapp.net` : '');

    const message = msg.message || {};
    let text = '';
    let type = 'text';
    let fileName = null;

    if (message.conversation) {
      text = message.conversation;
    } else if (message.extendedTextMessage?.text) {
      text = message.extendedTextMessage.text;
    } else if (message.imageMessage) {
      text = message.imageMessage.caption || '[Imagem]';
      type = 'image';
    } else if (message.videoMessage) {
      text = message.videoMessage.caption || '[Vídeo]';
      type = 'video';
    } else if (message.audioMessage) {
      text = '[Áudio]';
      type = 'audio';
    } else if (message.documentMessage) {
      text = `[Arquivo: ${message.documentMessage.fileName || 'documento'}]`;
      type = 'document';
      fileName = message.documentMessage.fileName;
    } else if (message.buttonsResponseMessage?.selectedButtonId) {
      text = message.buttonsResponseMessage.selectedButtonId;
    } else {
      return;
    }

    if (!phone) return;

    let quotedText = null;
    const ctx = message.extendedTextMessage?.contextInfo;
    if (ctx?.quotedMessage) {
      quotedText = ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text || null;
    }

    messageStore.add({
      from: fromMe ? 'bot' : (jid || phone),
      to: fromMe ? (jid || phone) : 'bot',
      body: text,
      direction: fromMe ? 'outgoing' : 'incoming',
      status: 'received',
      customerName: msg.pushName || phone,
      quotedText,
      type,
      fileName,
      timestamp: msg.messageTimestamp ?
        (typeof msg.messageTimestamp === 'number' ? new Date(msg.messageTimestamp * 1000).toISOString() : msg.messageTimestamp) :
        undefined
    });
    logger.info(`[${fromMe ? 'OUT' : 'IN'}] ${jid || phone}: ${text.substring(0, 50)} [${type}]`);
  }

  async _autoLoadHistory() {
    if (!this.sock || !this.isConnected) return;
    logger.info('[AUTO-LOAD] Starting automatic chat history load...');

    try {
      // Wait for chats to sync from WhatsApp server
      const delay = this._delay || ((ms) => new Promise(r => setTimeout(r, ms)));
      await delay(3000);

      // Try to get chats from store
      let chats = [];
      if (this.sock.store?.chats?.all) {
        chats = this.sock.store.chats.all();
        logger.info(`[AUTO-LOAD] Found ${chats.length} chats in store`);
      }

      if (chats.length === 0) {
        // Fallback: try using internal query to fetch chats
        try {
          const result = await this.sock.query({
            tag: 'get',
            attrs: { type: 'w:p', epoch: 'true' },
            content: [{ tag: 'count', attrs: {} }]
          });
          logger.info('[AUTO-LOAD] Query result:', JSON.stringify(result)?.substring(0, 200));
        } catch (qErr) {
          logger.warn('[AUTO-LOAD] Query failed:', qErr.message);
        }
      }

      // Load messages for each chat
      let loaded = 0;
      for (const chat of chats) {
        if (chat.id?.includes('@g.us')) continue;
        if (this._loadedChats.has(chat.id)) continue;
        this._loadedChats.add(chat.id);
        try {
          await this.loadMessagesFromChat(chat.id, chat.name);
          loaded++;
          await delay(500); // Small delay between chats
        } catch (err) {
          logger.warn(`[AUTO-LOAD] Failed to load ${chat.id}:`, err.message);
        }
      }

      logger.info(`[AUTO-LOAD] Completed: ${loaded} chats loaded, total messages: ${messageStore.count}`);
    } catch (err) {
      logger.error('[AUTO-LOAD] Error:', err.message);
    }
  }

  getQRCode() { return this.qrCode; }
  getPairingCode() { return this.pairingCode; }

  async requestPairingCode(phoneNumber) {
    if (!this.sock || !this.isConnected) throw new Error('WhatsApp not connected');
    const formattedPhone = formatPhone(phoneNumber);
    const code = await this.sock.requestPairingCode(formattedPhone);
    this.pairingCode = code;
    return code;
  }

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
          (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : 0) : 0;
        if (ts < sevenDaysAgo) continue;

        const message = msg.message;
        const fromMe = msg.key?.fromMe;
        const phone = chatId.replace('@s.whatsapp.net', '').replace('@lid', '');
        let text = '';
        let type = 'text';

        if (message.conversation) text = message.conversation;
        else if (message.extendedTextMessage?.text) text = message.extendedTextMessage.text;
        else if (message.imageMessage) { text = message.imageMessage.caption || '[Imagem]'; type = 'image'; }
        else if (message.videoMessage) { text = message.videoMessage.caption || '[Vídeo]'; type = 'video'; }
        else if (message.audioMessage) { text = '[Áudio]'; type = 'audio'; }
        else if (message.documentMessage) { text = `[Arquivo: ${message.documentMessage.fileName}]`; type = 'document'; }

        if (!text) continue;

        let quotedText = null;
        const ctx = message.extendedTextMessage?.contextInfo;
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
          quotedText, type,
          timestamp: new Date(ts).toISOString()
        });
        loaded++;
      }
      logger.info(`[HISTORY] ${chatId}: ${loaded} messages`);
    } catch (err) {
      logger.warn(`Failed to load history for ${chatId}:`, err.message);
    }
  }

  async sendMessage(phone, message, options = {}) {
    if (!this.sock || !this.isConnected) throw new Error('WhatsApp not connected');

    let jid;
    if (phone.includes('@')) {
      jid = phone;
    } else {
      const formattedPhone = formatPhone(phone);
      jid = `${formattedPhone}@s.whatsapp.net`;
      try {
        const [exists] = await this.sock.onWhatsApp(jid);
        if (!exists?.exists) return { success: false, error: 'Phone number not found on WhatsApp' };
        if (exists.jid && exists.jid !== jid) jid = exists.jid;
      } catch {
        logger.warn('onWhatsApp check failed, proceeding anyway');
      }
    }

    try {
      const payload = { text: message };
      if (options.quoted) {
        payload.quoted = { key: { remoteJid: jid, id: options.quoted, fromMe: false } };
      }
      const result = await this.sock.sendMessage(jid, payload);
      return { success: true, messageId: result?.key?.id, remoteJid: result?.key?.remoteJid };
    } catch (error) {
      logger.error('Failed to send message:', error);
      return { success: false, error: error.message };
    }
  }
}
