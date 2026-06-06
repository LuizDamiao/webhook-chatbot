import 'dotenv/config';

if (!process.env.WEBHOOK_TOKEN) {
  console.error('WEBHOOK_TOKEN environment variable is required');
  process.exit(1);
}

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import jwt from 'jsonwebtoken';
import { authMiddleware, authJWT } from './middleware/auth.js';
import { handleWebhook, whatsappService, parseLastLinkData } from './handlers/webhook.js';
import { getStats, getLogs, trackMessage } from './utils/tracker.js';
import { formatPhone } from './services/whatsapp.js';
import { authLimiter } from './middleware/rateLimiter.js';
import { messageStore } from './services/messageStore.js';
import templateRoutes from './routes/templates.js';
import aiRoutes from './routes/ai.js';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin';
const SESSION_DIR = process.env.SESSION_DIR || './auth_info';

function nowBrasilia() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
}

// CORS headers for GitHub Pages
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Raw body capture for webhook debugging
app.use(express.json({ limit: '10mb', verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));
app.use(express.urlencoded({ extended: true, verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));

const webhookLog = [];
const MAX_WEBHOOK_LOG = 20;

// Serve static files from public folder
app.use(express.static(join(__dirname, '../public')));

// Log ALL incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} from ${req.ip} | Content-Type: ${req.headers['content-type']} | User-Agent: ${req.headers['user-agent']}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug: log ALL requests (GET, POST, anything)
app.all('/{*splat}', (req, res, next) => {
  if (req.method === 'GET' && req.path === '/health') return next();
  console.log(`[${new Date().toISOString()}] ALL ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});

// API: Auth - returns JWT token
app.post('/api/auth', authLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  if (username !== DASHBOARD_USER || password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = jwt.sign(
    { username, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token, expiresIn: 86400 });
});

// API: Server and WhatsApp status
app.get('/api/status', authJWT, (req, res) => {
  res.json({
    server: {
      status: 'online',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    },
    whatsapp: {
      connected: whatsappService.isConnected,
      hasQRCode: !!whatsappService.getQRCode(),
      pairingCode: whatsappService.getPairingCode(),
      sessionDir: SESSION_DIR
    },
    messages: getStats()
  });
});

// API: Get QR code for WhatsApp connection (returns base64 image)
app.get('/api/qrcode', authJWT, async (req, res) => {
  const qr = whatsappService.getQRCode();
  if (qr) {
    try {
      let dataUrl;
      if (qr.startsWith('data:image')) {
        dataUrl = qr;
      } else {
        dataUrl = await QRCode.toDataURL(qr, { width: 260, margin: 2, color: { dark: '#1f2c34', light: '#ffffff' } });
      }
      res.json({ qr: dataUrl });
    } catch (err) {
      console.error('QR code generation error:', err);
      res.json({ qr: null, message: 'Erro ao gerar QR Code' });
    }
  } else {
    res.json({ qr: null, message: 'Nenhum QR Code disponível. WhatsApp pode estar conectado ou não iniciado.' });
  }
});

// POST /api/messages - Envia mensagem via WhatsApp
app.post('/api/messages', authJWT, async (req, res) => {
  console.log('[POST /api/messages] Body:', JSON.stringify(req.body));
  const { to, phone, text, body, quoted } = req.body;
  const recipient = to || phone;
  const messageText = text || body;

  console.log('[POST /api/messages] recipient:', recipient, 'text:', messageText?.substring(0, 50));

  if (!recipient || !messageText) {
    console.log('[POST /api/messages] MISSING FIELDS');
    return res.status(400).json({ error: 'to (or phone) and text (or body) are required' });
  }

  if (!whatsappService.isConnected) {
    console.log('[POST /api/messages] WHATSAPP NOT CONNECTED');
    return res.status(503).json({ error: 'WhatsApp not connected' });
  }

  try {
    const result = await whatsappService.sendMessage(recipient, messageText, { quoted });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to send message' });
    }

    const quotedMsg = quoted ? messageStore.messages.find(m => m.id === quoted) : null;
    const sentMessage = {
      from: 'bot',
      to: recipient,
      body: messageText,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
      id: result.messageId || Date.now().toString(),
      quotedText: quotedMsg?.body || null
    };

    const stored = messageStore.add(sentMessage);
    console.log(`[MSG] Stored outgoing message: to=${stored.to}, id=${stored.id}, storeCount=${messageStore.count}`);

    res.status(200).json({ success: true, message: sentMessage });
  } catch (error) {
    console.error('POST /api/messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/messages/audio - Envia áudio
app.post('/api/messages/audio', authJWT, async (req, res) => {
  const { phone, audio } = req.body;
  if (!phone || !audio) return res.status(400).json({ error: 'phone and audio (base64) required' });
  if (!whatsappService.isConnected) return res.status(503).json({ error: 'WhatsApp not connected' });
  try {
    const buffer = Buffer.from(audio.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
    const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    const result = await whatsappService.sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
    const stored = messageStore.add({ from: 'bot', to: phone, body: '[Áudio]', direction: 'outgoing', status: 'sent', type: 'audio', id: result?.key?.id });
    res.json({ success: true, message: stored });
  } catch (error) {
    console.error('Send audio error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/messages/document - Envia arquivo
app.post('/api/messages/document', authJWT, async (req, res) => {
  const { phone, file, fileName, mimeType } = req.body;
  if (!phone || !file) return res.status(400).json({ error: 'phone and file (base64) required' });
  if (!whatsappService.isConnected) return res.status(503).json({ error: 'WhatsApp not connected' });
  try {
    const buffer = Buffer.from(file.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    const result = await whatsappService.sock.sendMessage(jid, { document: buffer, fileName: fileName || 'arquivo', mimetype: mimeType || 'application/octet-stream' });
    const stored = messageStore.add({ from: 'bot', to: phone, body: `[Arquivo: ${fileName || 'arquivo'}]`, direction: 'outgoing', status: 'sent', type: 'document', fileName, id: result?.key?.id });
    res.json({ success: true, message: stored });
  } catch (error) {
    console.error('Send document error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/messages/image - Envia imagem
app.post('/api/messages/image', authJWT, async (req, res) => {
  const { phone, image, caption } = req.body;
  if (!phone || !image) return res.status(400).json({ error: 'phone and image (base64) required' });
  if (!whatsappService.isConnected) return res.status(503).json({ error: 'WhatsApp not connected' });
  try {
    let base64Data = image;
    let mimetype = 'image/jpeg';
    const match = image.match(/^data:(image\/\w+);base64,/);
    if (match) {
      mimetype = match[1];
      base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    }
    const buffer = Buffer.from(base64Data, 'base64');
    const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    console.log(`[IMAGE] Sending to ${jid}, size: ${buffer.length} bytes, type: ${mimetype}`);
    const result = await whatsappService.sock.sendMessage(jid, { image: buffer, caption: caption || '', mimetype });
    const stored = messageStore.add({ from: 'bot', to: phone, body: caption || '[Imagem]', direction: 'outgoing', status: 'sent', type: 'image', id: result?.key?.id });
    res.json({ success: true, message: stored });
  } catch (error) {
    console.error('Send image error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/messages - Retorna todas as mensagens
app.get('/api/messages', authJWT, (req, res) => {
  const messages = messageStore.getAll();
  res.json({ messages, count: messages.length });
});

// GET /api/messages/recent/:count - Retorna últimas N mensagens
app.get('/api/messages/recent/:count', authJWT, (req, res) => {
  const count = parseInt(req.params.count) || 50;
  const messages = messageStore.getRecent(count);
  res.json({ messages, count: messages.length });
});

// GET /api/messages/phone/:phone - Mensagens de um telefone
app.get('/api/messages/phone/:phone', authJWT, (req, res) => {
  const phone = req.params.phone;
  const messages = messageStore.getByPhone(phone);
  console.log(`[MSG] Query phone=${phone}, found=${messages.length}, totalStore=${messageStore.count}`);
  res.json({ messages, count: messages.length });
});

// GET /api/contacts - Lista contatos únicos das mensagens
app.get('/api/contacts', authJWT, (req, res) => {
  const messages = messageStore.getAll();
  const contactMap = new Map();

  // Excluir o próprio número do bot
  let botNumber = '';
  try {
    const rawId = whatsappService.sock?.user?.id || '';
    botNumber = rawId.replace(':', '').replace('@s.whatsapp.net', '').replace('@lid', '');
  } catch {}

  messages.forEach(msg => {
    const phone = msg.direction === 'outgoing' ? msg.to : msg.from;
    if (!phone || phone === 'bot') return;

    // Pular números do próprio bot
    const cleanPhone = phone.replace('@s.whatsapp.net', '').replace('@lid', '').replace(':', '');
    if (botNumber && cleanPhone === botNumber) return;

    // Tentar normalizar: se o phone é LID, verificar se já existe contato com o mesmo nome
    const normalizedName = (msg.customerName || '').trim().toLowerCase();
    let contactKey = phone;
    let merged = false;

    if (normalizedName) {
      for (const [key, existing] of contactMap) {
        if ((existing.name || '').trim().toLowerCase() === normalizedName) {
          contactKey = key;
          merged = true;
          break;
        }
      }
    }

    if (!contactMap.has(contactKey)) {
      contactMap.set(contactKey, {
        phone: contactKey,
        name: msg.customerName || phone,
        lastMessage: msg.body,
        lastMessageTime: msg.timestamp,
        unread: 0
      });
    } else {
      const contact = contactMap.get(contactKey);
      contact.lastMessage = msg.body;
      contact.lastMessageTime = msg.timestamp;
      if (msg.customerName && !contact.name.includes(msg.customerName)) {
        contact.name = msg.customerName;
      }
    }
  });

  const contacts = Array.from(contactMap.values())
    .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

  res.json({ contacts, count: contacts.length });
});

// POST /api/messages/read - Mark messages as read on WhatsApp
app.post('/api/messages/read', authJWT, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  if (!whatsappService.isConnected) return res.status(503).json({ error: 'WhatsApp not connected' });

  try {
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    const unread = messageStore.messages.filter(m => m.from === phone && m.direction === 'incoming' && m.status !== 'read');
    if (unread.length > 0) {
      const keys = unread.map(m => m.id ? { remoteJid: jid, id: m.id, fromMe: false } : null).filter(Boolean);
      if (keys.length > 0) {
        try { await whatsappService.sock.readMessages(keys); } catch {}
      }
      unread.forEach(m => { messageStore.updateStatus(m.id, 'read'); });
    }
    res.json({ success: true, marked: unread.length });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/whatsapp/load-chats - Force load all chats from WhatsApp
app.post('/api/whatsapp/load-chats', authJWT, async (req, res) => {
  if (!whatsappService.isConnected) return res.status(503).json({ error: 'WhatsApp not connected' });
  try {
    const sock = whatsappService.sock;
    const contactMap = new Map();
    messageStore.messages.forEach(m => {
      const phone = m.direction === 'incoming' ? m.from : m.to;
      if (phone && phone !== 'bot' && !contactMap.has(phone)) {
        contactMap.set(phone, { id: `${phone}@s.whatsapp.net`, name: m.customerName || phone });
      }
    });
    const chats = Array.from(contactMap.values());
    let loaded = 0;
    for (const chat of chats) {
      if (chat.id?.includes('@g.us')) continue;
      try {
        const history = await sock.loadMessages(chat.id, 50);
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        for (const msg of (history?.messages || [])) {
          const ts = msg.messageTimestamp ? (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : 0) : 0;
          if (ts < sevenDaysAgo) continue;
          const fromMe = msg.key?.fromMe;
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
          if (!text) continue;
          let quotedText = null;
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          if (ctx?.quotedMessage) {
            quotedText = ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text || null;
          }
          messageStore.add({
            from: fromMe ? 'bot' : chat.id, to: fromMe ? chat.id : 'bot',
            body: text, direction: fromMe ? 'outgoing' : 'incoming', status: 'synced',
            customerName: chat.name || chat.id, quotedText, timestamp: new Date(ts).toISOString()
          });
        }
        loaded++;
      } catch {}
    }
    res.json({ success: true, loaded, total: chats.length, messages: messageStore.count });
  } catch (error) {
    console.error('Load chats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/whatsapp/load-chat/:phone - Load history for a specific contact
app.post('/api/whatsapp/load-chat/:phone', authJWT, async (req, res) => {
  if (!whatsappService.isConnected) return res.status(503).json({ error: 'WhatsApp not connected' });
  const phone = req.params.phone;
  try {
    const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    const sock = whatsappService.sock;
    const history = await sock.loadMessages(jid, 50);
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let loaded = 0;
    for (const msg of (history?.messages || [])) {
      if (!msg.message) continue;
      const ts = msg.messageTimestamp ? (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : 0) : 0;
      if (ts < sevenDaysAgo) continue;
      const fromMe = msg.key?.fromMe;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!text) continue;
      let quotedText = null;
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      if (ctx?.quotedMessage) {
        quotedText = ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text || null;
      }
      messageStore.add({
        from: fromMe ? 'bot' : jid, to: fromMe ? jid : 'bot',
        body: text, direction: fromMe ? 'outgoing' : 'incoming', status: 'synced',
        customerName: phone, quotedText, timestamp: new Date(ts).toISOString()
      });
      loaded++;
    }
    res.json({ success: true, loaded });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Template routes
app.use('/api/templates', templateRoutes);

// AI routes
app.use(aiRoutes);

// API: Request pairing code (alternative to QR)
app.post('/api/pairing', async (req, res) => {
  const { telefone } = req.body;
  if (!telefone) {
    return res.status(400).json({ error: 'telefone required' });
  }
  if (!whatsappService.isConnected) {
    return res.status(503).json({ error: 'WhatsApp not connected' });
  }
  try {
    const code = await whatsappService.requestPairingCode(telefone);
    res.json({ code, phone: formatPhone(telefone) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Reset WhatsApp session (clear all session files and reconnect)
app.post('/api/whatsapp/reset', authJWT, async (req, res) => {
  try {
    console.log('[RESET] Clearing session...');
    whatsappService.resetSession();
    setTimeout(() => {
      console.log('[RESET] Reconnecting...');
      whatsappService.connect().catch(err => console.error('[RESET] Reconnect failed:', err.message));
    }, 2000);
    res.json({ success: true, message: 'Session cleared. Reconnecting in 2s...' });
  } catch (error) {
    console.error('[RESET] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Webhook endpoint (returns JSON for dashboard)
app.post('/api/webhook', async (req, res) => {
  const entry = {
    timestamp: nowBrasilia(),
    endpoint: '/api/webhook',
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    },
    rawBody: req.rawBody || null,
    body: req.body
  };
  webhookLog.unshift(entry);
  if (webhookLog.length > MAX_WEBHOOK_LOG) webhookLog.pop();

  const { nome, telefone, produto } = parseLastLinkData(req.body);

  if (!nome || !telefone || !produto) {
    return res.status(400).json({
      error: 'Missing required fields: nome, telefone, produto'
    });
  }

  if (!whatsappService.isConnected) {
    return res.status(503).json({ error: 'WhatsApp not connected' });
  }

  try {
    const { formatCartMessage } = await import('./templates/message.js');
    const message = formatCartMessage(nome, produto);
    const result = await whatsappService.sendMessage(telefone, message);

    trackMessage(nome, telefone, result.success);

    if (result.success) {
      res.status(200).json({ success: true });
    } else {
      console.error('WhatsApp send failed:', result.error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// API: Recent webhook logs
app.get('/api/logs', (req, res) => {
  res.json({ logs: getLogs() });
});

// API: Diagnostic send with full result
app.post('/api/diagnostic', async (req, res) => {
  const { telefone } = req.body;
  if (!telefone) {
    return res.status(400).json({ error: 'telefone required' });
  }
  if (!whatsappService.isConnected) {
    return res.status(503).json({ error: 'WhatsApp not connected' });
  }
  try {
    const result = await whatsappService.sendMessage(telefone, 'Teste diagnostico');
    const sock = whatsappService.sock;
    let phoneExists = false;
    try {
      const phoneInfo = await sock.onWhatsApp(`${formatPhone(telefone)}@s.whatsapp.net`);
      phoneExists = phoneInfo;
    } catch {}
    res.json({
      sendResult: result,
      phoneExists,
      connectionState: {
        isConnected: whatsappService.isConnected,
        user: sock?.user?.id,
        platform: sock?.user?.platform
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Webhook endpoint for LastLink
app.post('/webhook', (req, res, next) => {
  const entry = {
    timestamp: nowBrasilia(),
    headers: {
      'content-type': req.headers['content-type'],
      'authorization': req.headers['authorization'] ? '[PRESENT]' : '[MISSING]',
      'user-agent': req.headers['user-agent'],
      'x-webhook': req.headers['x-webhook'] || null
    },
    rawBody: req.rawBody || null,
    body: req.body
  };
  webhookLog.unshift(entry);
  if (webhookLog.length > MAX_WEBHOOK_LOG) webhookLog.pop();
  console.log('=== WEBHOOK RECEIVED FROM LASTLINK ===');
  console.log(JSON.stringify(entry, null, 2));
  console.log('======================================');
  const parsed = parseLastLinkData(req.body);
  handleWebhook(req, res, parsed);
});

// API: Raw webhook log (what LastLink sent)
app.get('/api/webhook-raw', (req, res) => {
  res.json({ count: webhookLog.length, webhooks: webhookLog });
});

// API: Clear webhook log
app.delete('/api/webhook-raw', (req, res) => {
  webhookLog.length = 0;
  res.json({ success: true, message: 'Webhook log cleared' });
});

// Catch-all POST to debug any incoming request
app.post('/{*splat}', (req, res) => {
  const entry = {
    timestamp: nowBrasilia(),
    endpoint: req.originalUrl,
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => ['content-type', 'authorization', 'user-agent', 'x-webhook', 'x-forwarded-for', 'host', 'origin', 'referer'].includes(k))),
    rawBody: req.rawBody || null,
    body: req.body
  };
  webhookLog.unshift(entry);
  if (webhookLog.length > MAX_WEBHOOK_LOG) webhookLog.pop();
  console.log('=== CATCH-ALL POST RECEIVED ===');
  console.log(JSON.stringify(entry, null, 2));
  console.log('===============================');
  res.status(200).json({ received: true });
});

// Auto-seed knowledge base if empty
async function autoSeedKnowledge() {
  try {
    const { getAllChunks, addChunk } = await import('./services/knowledge.js');
    const existing = getAllChunks();
    if (existing.length > 0) {
      console.log(`[SEED] Knowledge base already has ${existing.length} chunks, skipping seed`);
      return;
    }
    console.log('[SEED] Knowledge base empty, seeding LipedemaCare data...');

    const KNOWLEDGE_DATA = [
      { category: 'produto', aida_phase: 'general', content: 'O LipedemaCare é uma plataforma completa de tratamento para lipedema. Foi criado por mulheres que entendem exatamente o que você está passando. Inclui videoaulas, exercícios guiados, receitas, comunidade de apoio e lembretes inteligentes.' },
      { category: 'produto', aida_phase: 'interest', content: 'O LipedemaCare oferece: Acompanhamento diário de sintomas, Exercícios guiados específicos para lipedema, Monitoramento de saúde (circunferência, peso, dor), Comunidade de apoio, Educação continuada com artigos e vídeos, Lembretes inteligentes para medicamentos e consultas.' },
      { category: 'beneficios', aida_phase: 'desire', content: 'Redução da Dor e Inchaço: Com técnicas de drenagem linfática e exercícios adaptados, você pode sentir alívio real e duradouro dos sintomas. Muitas pacientes relatam melhora significativa em poucas semanas.' },
      { category: 'beneficios', aida_phase: 'desire', content: 'Recuperação da Mobilidade: Volte a fazer as coisas que você amava. Caminhar, brincar, se movimentar livremente sem a constante dor te limitando. Exercícios progressivos que respeitam seu ritmo.' },
      { category: 'beneficios', aida_phase: 'desire', content: 'Comunidade Que Entende: Conecte-se com outras mulheres que vivem a mesma realidade. Compartilhe experiências, receba apoio e nunca mais se sinta sozinha. Mais de 500 mulheres já estão cuidando delas.' },
      { category: 'beneficios', aida_phase: 'desire', content: 'Recuperação da Autoestima: Aprenda a se amar novamente, aceitar seu corpo e focar no que realmente importa: sua saúde e seu bem-estar. O lipedema não define quem você é.' },
      { category: 'preco', aida_phase: 'action', content: 'O LipedemaCare custa R$37,90 por mês. São menos de R$1,30 por dia - menos que um café! Você pode cancelar a qualquer momento, sem multa ou burocracia.' },
      { category: 'preco', aida_phase: 'desire', content: 'Quanto tempo você já gastou tentando resolver o lipedema? Remédios, consultas, tratamentos que não funcionam? O LipedemaCare são R$37,90/mês, menos que R$1,30 por dia. Um investimento pequeno para uma grande mudança na sua qualidade de vida.' },
      { category: 'exercicios', aida_phase: 'interest', content: 'O LipedemaCare tem exercícios guiados específicos para lipedema, com vídeos e instruções passo a passo. São exercícios de baixo impacto que podem ser feitos em casa, respeitando os limites do seu corpo.' },
      { category: 'exercicios', aida_phase: 'desire', content: 'Posso te mandar um exercício que alivia a dor agora? É um exercício simples de drenagem linfática que nossas pacientes adoram. Não custa nada experimentar!' },
      { category: 'comunidade', aida_phase: 'desire', content: 'No LipedemaCare você encontra uma comunidade de mais de 500 mulheres que estão passando pelo mesmo que você. Compartilhem experiências, dicas e se apoiem mutuamente. Ninguém deveria enfrentar o lipedema sozinha.' },
      { category: 'faq', aida_phase: 'general', content: 'Pergunta: Funciona para varizes? Resposta: O LipedemaCare é focado em lipedema, mas os exercícios de drenagem linfática podem ajudar com a circulação em geral. Consulte seu médico para orientação específica.' },
      { category: 'faq', aida_phase: 'general', content: 'Pergunta: Preciso de equipamento? Resposta: Não! Todos os exercícios podem ser feitos em casa, sem equipamento especial. Você só precisa de um espaço confortável e roupas confortáveis.' },
      { category: 'faq', aida_phase: 'general', content: 'Pergunta: Em quanto tempo vou ver resultados? Resposta: Muitas pacientes relatam melhora em 2-4 semanas. Mas cada corpo é diferente. O importante é a consistência - continue praticando e você verá resultados.' },
      { category: 'urgencia', aida_phase: 'action', content: 'Quanto antes você começar o tratamento, mais rápido vai sentir alívio. Cada dia sem tratamento é mais um dia com dor e limitação. Não deixe para depois - seu corpo merece cuidado agora.' },
      { category: 'urgencia', aida_phase: 'action', content: 'O lipedema é progressivo - sem tratamento, piora com o tempo. Comece hoje para evitar complicações amanhã. O LipedemaCare é o caminho mais acessível e eficaz para cuidar de você.' }
    ];

    for (const item of KNOWLEDGE_DATA) {
      try {
        await addChunk(item.category, item.aida_phase, item.content);
        console.log(`[SEED] ✅ ${item.category}: ${item.content.substring(0, 40)}...`);
      } catch (e) {
        console.error(`[SEED] ❌ Failed: ${e.message}`);
      }
    }
    console.log(`[SEED] Knowledge base seeded with ${KNOWLEDGE_DATA.length} chunks`);
  } catch (error) {
    console.error('[SEED] Auto-seed failed:', error.message);
  }
}

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  // Auto-seed knowledge base if GROQ_API_KEY is set
  if (process.env.GROQ_API_KEY) {
    autoSeedKnowledge();
  } else {
    console.log('[SEED] GROQ_API_KEY not set, skipping knowledge base seed');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});

export { JWT_SECRET, DASHBOARD_USER, DASHBOARD_PASSWORD, SESSION_DIR };
export default app;
