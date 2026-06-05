import { messageStore } from './messageStore.js';

export function formatPhone(phone) {
  if (!phone) throw new Error('Invalid phone number');
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 10 || cleaned.length > 13) throw new Error('Invalid phone number');
  return cleaned.startsWith('55') ? cleaned : `55${cleaned}`;
}

export class WhatsAppService {
  constructor(sessionDir) {
    this.sessionDir = sessionDir || './auth_info';
    this.client = null;
    this.isConnected = false;
    this.qrCode = null;
    this.pairingCode = null;
    this._loadedChats = new Set();
  }

  async connect() {
    try {
      console.log('[WA] Starting WPPConnect...');
      const WPP = await import('@wppconnect-team/wppconnect');

      this.client = await WPP.default.create({
        session: this.sessionDir,
        authTimeout: 0,
        qrTimeout: 0,
        puppeteerOptions: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ]
        }
      });

      console.log('[WA] WPPConnect client created, waiting for QR...');

      this.client.onQR(async (qr) => {
        console.log('[WA] QR Code received');
        this.qrCode = qr;
      });

      this.client.onReady(() => {
        console.log('[WA] WhatsApp connected and ready');
        this.isConnected = true;
        this.qrCode = null;
        this._loadedChats.clear();
        this._loadHistory();
      });

      this.client.onDisconnected(() => {
        console.log('[WA] WhatsApp disconnected');
        this.isConnected = false;
        this.qrCode = null;
      });

      this.client.onMessage(async (message) => {
        try {
          const fromMe = message.fromMe;
          const chatId = message.chatId || '';
          const phone = chatId.replace('@c.us', '').replace('@g.us', '');
          const isGroup = chatId.includes('@g.us');
          if (isGroup) return;

          const text = message.body || '';
          if (!text) return;

          let quotedText = null;
          if (message.quotedMsg?.body) {
            quotedText = message.quotedMsg.body;
          }

          let type = 'text';
          if (message.isMedia || message.isMMS) {
            type = message.type || 'media';
          }

          messageStore.add({
            from: fromMe ? 'bot' : phone,
            to: fromMe ? phone : 'bot',
            body: text,
            direction: fromMe ? 'outgoing' : 'incoming',
            status: 'received',
            customerName: message.notifyName || phone,
            quotedText,
            type,
            timestamp: message.timestamp ? new Date(message.timestamp * 1000).toISOString() : new Date().toISOString()
          });
          console.log(`[${fromMe ? 'OUT' : 'IN'}] ${phone}: ${text.substring(0, 50)}`);
        } catch (err) {
          console.error('[WA] Message processing error:', err.message);
        }
      });

    } catch (error) {
      console.error('[WA] Failed to initialize:', error.message);
      throw error;
    }
  }

  async _loadHistory() {
    if (!this.client || !this.isConnected) return;
    console.log('[HISTORY] Loading chat history...');

    try {
      const chats = await this.client.listChats({ onlyUsers: true, limit: 50 });
      console.log(`[HISTORY] Found ${chats.length} chats`);

      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      let loaded = 0;

      for (const chat of chats) {
        const chatId = chat.id;
        if (!chatId || chatId.includes('@g.us')) continue;
        if (this._loadedChats.has(chatId)) continue;
        this._loadedChats.add(chatId);

        try {
          const messages = await this.client.getMessages(chatId, 50);
          let count = 0;

          for (const msg of (messages || [])) {
            const ts = msg.timestamp ? msg.timestamp * 1000 : 0;
            if (ts < sevenDaysAgo) continue;

            const fromMe = msg.fromMe;
            const phone = chatId.replace('@c.us', '');
            const text = msg.body || '';
            if (!text) continue;

            let quotedText = null;
            if (msg.quotedMsg?.body) quotedText = msg.quotedMsg.body;

            messageStore.add({
              from: fromMe ? 'bot' : phone,
              to: fromMe ? phone : 'bot',
              body: text,
              direction: fromMe ? 'outgoing' : 'incoming',
              status: 'synced',
              customerName: chat.name || phone,
              quotedText,
              type: msg.isMedia ? 'media' : 'text',
              timestamp: ts ? new Date(ts).toISOString() : new Date().toISOString()
            });
            count++;
          }
          loaded++;
          console.log(`[HISTORY] ${chatId}: ${count} messages`);
        } catch (err) {
          console.warn(`[HISTORY] Failed ${chatId}:`, err.message);
        }
      }
      console.log(`[HISTORY] Done: ${loaded} chats, ${messageStore.count} total messages`);
    } catch (err) {
      console.error('[HISTORY] Error:', err.message);
    }
  }

  getQRCode() { return this.qrCode; }
  getPairingCode() { return this.pairingCode; }

  async requestPairingCode(phoneNumber) {
    if (!this.client || !this.isConnected) throw new Error('WhatsApp not connected');
    const formattedPhone = formatPhone(phoneNumber);
    const code = await this.client.requestPairingCode(formattedPhone);
    this.pairingCode = code;
    return code;
  }

  async sendMessage(phone, message, options = {}) {
    if (!this.client || !this.isConnected) throw new Error('WhatsApp not connected');

    let chatId;
    if (phone.includes('@')) {
      chatId = phone;
    } else {
      const formattedPhone = formatPhone(phone);
      chatId = `${formattedPhone}@c.us`;
    }

    try {
      const result = await this.client.sendText(chatId, message);
      return { success: true, messageId: result?.key?.id || result?.id, remoteJid: chatId };
    } catch (error) {
      console.error('[WA] Send failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}
