import pino from 'pino';
import { messageStore } from './messageStore.js';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const logger = pino({ level: 'warn' });
const BAILEYS_VERSION = '6.7.16';

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
  }

  async connect() {
    try {
      // Check if session is from a different Baileys version — clear if so
      const versionFile = join(this.sessionDir, '.baileys-version');
      try {
        if (existsSync(versionFile)) {
          const stored = readFileSync(versionFile, 'utf-8').trim();
          if (stored !== BAILEYS_VERSION) {
            logger.info(`Session version mismatch (${stored} vs ${BAILEYS_VERSION}), clearing session`);
            rmSync(this.sessionDir, { recursive: true, force: true });
          }
        } else if (existsSync(join(this.sessionDir, 'creds.json'))) {
          // Has old session but no version marker — assume old version
          logger.info('Old session detected (no version marker), clearing');
          rmSync(this.sessionDir, { recursive: true, force: true });
        }
      } catch {}
      writeFileSync(versionFile, BAILEYS_VERSION, 'utf-8');

      const baileys = await import('@whiskeysockets/baileys');
      const { state, saveCreds } = await baileys.useMultiFileAuthState(this.sessionDir);

      this.sock = baileys.makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: logger,
        browser: ['ChatBot Webhook', 'Chrome', '4.0.0'],
        markOnlineOnConnect: false
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
          const shouldReconnect = statusCode !== baileys.DisconnectReason.loggedOut;
          logger.info(`Connection closed (code: ${statusCode}), reconnect: ${shouldReconnect}`);
          this.isConnected = false;
          this.qrCode = null;
          this.pairingCode = null;
          this._loadedChats.clear();
          if (shouldReconnect) {
            setTimeout(() => this.connect(), 3000);
          }
        } else if (connection === 'open') {
          logger.info('WhatsApp connected');
          this.isConnected = true;
          this.qrCode = null;
          this.pairingCode = null;
          this._loadedChats.clear();
          setTimeout(() => this._loadAllHistory(), 5000);
        }
      });

      // Load chats as they sync from WhatsApp
      this.sock.ev.on('chats.upsert', (chats) => {
        logger.info(`[CHATS] ${chats.length} chats upserted`);
        for (const chat of chats) {
          if (chat.id?.includes('@g.us')) continue;
          if (this._loadedChats.has(chat.id)) continue;
          this._loadedChats.add(chat.id);
          this._loadChatMessages(chat.id, chat.name).catch(err =>
            logger.warn(`Failed to load ${chat.id}:`, err.message)
          );
        }
      });

      // Capture all new messages (incoming and outgoing)
      this.sock.ev.on('messages.upsert', (event) => {
        try {
          const { messages, type } = event;
          if (type !== 'notify') return;
          for (const msg of messages) {
            const entry = this._parseMessage(msg);
            if (entry) messageStore.add(entry);
          }
        } catch (err) {
          logger.error('Error processing message:', err);
        }
      });

      // Update delivery/read status
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
              if (msg) msg.status = statusText;
            }
          } catch (err) {
            logger.error('Status update error:', err);
          }
        }
      });

    } catch (error) {
      logger.error('Failed to initialize WhatsApp:', error);
      throw error;
    }
  }

  // Load all chat history from store after connection
  async _loadAllHistory() {
    if (!this.sock || !this.isConnected) return;
    logger.info('[HISTORY] Starting history load...');

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    // In Baileys v6, store is created by default
    let chats = [];
    try {
      if (this.sock.store?.chats?.all) {
        chats = this.sock.store.chats.all();
        logger.info(`[HISTORY] Store has ${chats.length} chats`);
      }
    } catch (e) {
      logger.warn('[HISTORY] Store access failed:', e.message);
    }

    // Load messages for each chat
    let loaded = 0;
    for (const chat of chats) {
      if (chat.id?.includes('@g.us')) continue;
      if (this._loadedChats.has(chat.id)) continue;
      this._loadedChats.add(chat.id);
      try {
        await this._loadChatMessages(chat.id, chat.name);
        loaded++;
        await delay(500);
      } catch (err) {
        logger.warn(`[HISTORY] Failed ${chat.id}:`, err.message);
      }
    }

    logger.info(`[HISTORY] Done: ${loaded} chats, ${messageStore.count} total messages`);
  }

  // Load messages for a specific chat
  async _loadChatMessages(chatId, chatName) {
    if (!this.sock) return;

    try {
      const result = await this.sock.loadMessages(chatId, 50);
      const messages = result?.messages || [];
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      let count = 0;

      for (const msg of messages) {
        if (!msg.message) continue;
        const ts = msg.messageTimestamp ?
          (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : 0) : 0;
        if (ts < sevenDaysAgo) continue;

        const entry = this._parseMessage(msg, chatId, chatName);
        if (entry) {
          messageStore.add(entry);
          count++;
        }
      }

      logger.info(`[LOAD] ${chatId}: ${count} messages`);
    } catch (err) {
      logger.warn(`[LOAD] Error ${chatId}:`, err.message);
    }
  }

  _parseMessage(msg, fallbackJid, fallbackName) {
    const fromMe = msg.key?.fromMe;
    const rawJid = msg.key?.remoteJid || fallbackJid || '';
    let phone = msg.key?.participant?.replace('@s.whatsapp.net', '')?.replace('@lid', '') ||
                rawJid.replace('@s.whatsapp.net', '').replace('@lid', '') || '';
    const jid = rawJid.includes('@lid') ? rawJid : (phone ? `${phone}@s.whatsapp.net` : '');

    const message = msg.message || {};
    let text = '';
    let type = 'text';

    if (message.conversation) text = message.conversation;
    else if (message.extendedTextMessage?.text) text = message.extendedTextMessage.text;
    else if (message.imageMessage) { text = message.imageMessage.caption || '[Imagem]'; type = 'image'; }
    else if (message.videoMessage) { text = message.videoMessage.caption || '[Vídeo]'; type = 'video'; }
    else if (message.audioMessage) { text = '[Áudio]'; type = 'audio'; }
    else if (message.documentMessage) { text = `[Arquivo: ${message.documentMessage.fileName}]`; type = 'document'; }
    else if (message.buttonsResponseMessage?.selectedButtonId) text = message.buttonsResponseMessage.selectedButtonId;
    else return null;

    if (!phone && !jid) return null;

    let quotedText = null;
    const ctx = message.extendedTextMessage?.contextInfo;
    if (ctx?.quotedMessage) {
      quotedText = ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text || null;
    }

    const ts = msg.messageTimestamp ?
      (typeof msg.messageTimestamp === 'number' ? new Date(msg.messageTimestamp * 1000).toISOString() : msg.messageTimestamp) :
      new Date().toISOString();

    return {
      from: fromMe ? 'bot' : (jid || phone),
      to: fromMe ? (jid || phone) : 'bot',
      body: text,
      direction: fromMe ? 'outgoing' : 'incoming',
      status: 'received',
      customerName: fallbackName || msg.pushName || phone,
      quotedText, type, timestamp: ts
    };
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
        logger.warn('onWhatsApp check failed, proceeding');
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
