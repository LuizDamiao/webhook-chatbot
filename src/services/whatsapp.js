import { messageStore } from './messageStore.js';
import {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  makeWASocket,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import path from 'path';
import fs from 'fs';
import pino from 'pino';

const logger = pino({ level: 'silent' });

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
    this._started = false;
  }

  async connect() {
    if (this._started) return;
    this._started = true;

    try {
      console.log('[WA] Starting Baileys...');

      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }

      this._cleanWPPConnectFiles();

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      const { version } = await fetchLatestBaileysVersion();
      console.log(`[WA] Baileys version: ${version.join('.')}`);

      this.sock = makeWASocket({
        version,
        logger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        browser: ['ChatBot Webhook', 'Chrome', '4.0.0'],
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('[WA] QR Code received');
          this.qrCode = qr;
        }

        if (connection === 'open') {
          console.log('[WA] WhatsApp connected');
          this.isConnected = true;
          this.qrCode = null;
          setTimeout(() => this._loadAllHistory(), 3000);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log(`[WA] Connection closed: ${statusCode}`);

          this.isConnected = false;
          this._started = false;

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('[WA] Session logged out, clearing files...');
            this._clearSession();
          } else if (statusCode === 405 || statusCode === 401 || statusCode === 408) {
            console.log(`[WA] Error ${statusCode}, clearing session and reconnecting...`);
            this._clearSession();
            setTimeout(() => this.connect(), 5000);
          } else {
            console.log('[WA] Reconnecting in 5s...');
            setTimeout(() => this.connect(), 5000);
          }
        }
      });

      this.sock.ev.on('messages.upsert', (m) => {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
          this._processMessage(msg);
        }
      });

      this.sock.ev.on('messages.update', (updates) => {
        for (const update of updates) {
          if (update.update?.status) {
            const statusMap = { 1: 'sent', 2: 'delivered', 3: 'read' };
            const status = statusMap[update.update.status] || 'unknown';
            console.log(`[WA] Message ${update.key.id} status: ${status}`);
          }
        }
      });

    } catch (error) {
      console.error('[WA] Failed to initialize:', error.message);
      this._started = false;
      throw error;
    }
  }

  _cleanWPPConnectFiles() {
    const chromeDirs = ['Default', 'Crashpad', 'GrShaderCache', 'ShaderCache', 'GraphiteDawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'segmentation_platform'];
    const chromeFiles = ['DevToolsActivePort', 'Last Version', 'Local State', 'Variations', 'CrashpadMetrics-active.pma'];

    for (const dir of chromeDirs) {
      const dirPath = path.join(this.sessionDir, dir);
      if (fs.existsSync(dirPath)) {
        try {
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`[WA] Cleaned WPPConnect dir: ${dir}`);
        } catch {}
      }
    }
    for (const file of chromeFiles) {
      const filePath = path.join(this.sessionDir, file);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`[WA] Cleaned WPPConnect file: ${file}`);
        } catch {}
      }
    }
  }

  _clearSession() {
    try {
      if (fs.existsSync(this.sessionDir)) {
        const files = fs.readdirSync(this.sessionDir);
        for (const file of files) {
          const filePath = path.join(this.sessionDir, file);
          try {
            if (fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
              console.log(`[WA] Deleted: ${file}`);
            }
          } catch {}
        }
        console.log('[WA] Session cleared');
      }
    } catch (err) {
      console.error('[WA] Error clearing session:', err.message);
    }
  }

  _processMessage(msg) {
    try {
      const chatId = msg.key.remoteJid || '';
      const isGroup = chatId.includes('@g.us');
      if (isGroup) return;

      const phone = chatId.replace('@c.us', '').replace('@s.whatsapp.net', '');
      const fromMe = msg.key.fromMe;

      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.buttonsResponseMessage?.selectedButtonId
        || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId
        || '';

      if (!text) return;

      let quotedText = null;
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      if (ctx?.quotedMessage) {
        quotedText = ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text || null;
      }

      let type = 'text';
      if (msg.message?.imageMessage) type = 'image';
      else if (msg.message?.videoMessage) type = 'video';
      else if (msg.message?.audioMessage) type = 'audio';
      else if (msg.message?.documentMessage) type = 'document';

      messageStore.add({
        from: fromMe ? 'bot' : phone,
        to: fromMe ? phone : 'bot',
        body: text,
        direction: fromMe ? 'outgoing' : 'incoming',
        status: fromMe ? 'sent' : 'received',
        customerName: msg.pushName || phone,
        quotedText,
        type,
        timestamp: msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()
      });
      console.log(`[${fromMe ? 'OUT' : 'IN'}] ${phone}: ${text.substring(0, 50)}`);
    } catch (err) {
      console.error('[WA] Message error:', err.message);
    }
  }

  async _loadAllHistory() {
    if (!this.sock || !this.isConnected) return;
    console.log('[HISTORY] Loading all chat history...');

    try {
      const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
      let totalMessages = 0;

      const phoneMap = new Map();
      messageStore.messages.forEach(m => {
        const p = m.direction === 'incoming' ? m.from : m.to;
        if (p && p !== 'bot' && !phoneMap.has(p)) phoneMap.set(p, m.customerName || p);
      });

      console.log(`[HISTORY] Loading history for ${phoneMap.size} contacts...`);

      for (const [phone, name] of phoneMap) {
        try {
          const jid = `${phone}@s.whatsapp.net`;
          const result = await this.sock.loadMessages(jid, 50);
          const msgs = result?.messages || [];
          let count = 0;

          for (const m of msgs) {
            const ts = m.messageTimestamp;
            if (!ts || ts < sevenDaysAgo) continue;

            const fromMe = m.key?.fromMe;
            const text = m.message?.conversation
              || m.message?.extendedTextMessage?.text
              || m.message?.buttonsResponseMessage?.selectedButtonId
              || m.message?.listResponseMessage?.singleSelectReply?.selectedRowId
              || '';
            if (!text) continue;

            let quotedText = null;
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            if (ctx?.quotedMessage) {
              quotedText = ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text || null;
            }

            messageStore.add({
              from: fromMe ? 'bot' : phone,
              to: fromMe ? phone : 'bot',
              body: text,
              direction: fromMe ? 'outgoing' : 'incoming',
              status: 'synced',
              customerName: name,
              quotedText,
              timestamp: new Date(ts * 1000).toISOString()
            });
            count++;
          }
          totalMessages += count;
          console.log(`[HISTORY] ${phone}: ${count} messages loaded`);
        } catch (err) {
          console.warn(`[HISTORY] Failed ${phone}:`, err.message);
        }
      }

      console.log(`[HISTORY] Done. Total: ${totalMessages} messages from ${phoneMap.size} contacts`);
    } catch (err) {
      console.error('[HISTORY] Error:', err.message);
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

  async sendMessage(phone, message, options = {}) {
    if (!this.sock || !this.isConnected) throw new Error('WhatsApp not connected');

    let chatId;
    if (phone.includes('@')) {
      chatId = phone;
    } else {
      const formattedPhone = formatPhone(phone);
      chatId = `${formattedPhone}@c.us`;
    }

    try {
      const result = await this.sock.sendMessage(chatId, { text: message });
      return { success: true, messageId: result?.key?.id, remoteJid: chatId };
    } catch (error) {
      console.error('[WA] Send failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  resetSession() {
    this._started = false;
    this.isConnected = false;
    this.qrCode = null;
    this.sock = null;
    this._clearSession();
  }
}
