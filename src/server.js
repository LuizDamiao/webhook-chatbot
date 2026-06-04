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
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Raw body capture for webhook debugging
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));
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

// API: Get QR code for WhatsApp connection
app.get('/api/qrcode', authJWT, (req, res) => {
  const qr = whatsappService.getQRCode();
  if (qr) {
    res.json({ qr });
  } else {
    res.json({ qr: null, message: 'No QR code available. WhatsApp might be connected or not started yet.' });
  }
});

// POST /api/messages - Envia mensagem via WhatsApp
app.post('/api/messages', authJWT, async (req, res) => {
  const { to, phone, text, body } = req.body;
  const recipient = to || phone;
  const messageText = text || body;

  if (!recipient || !messageText) {
    return res.status(400).json({ error: 'to (or phone) and text (or body) are required' });
  }

  if (!whatsappService.isConnected) {
    return res.status(503).json({ error: 'WhatsApp not connected' });
  }

  try {
    const result = await whatsappService.sendMessage(recipient, messageText);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to send message' });
    }

    const sentMessage = {
      from: 'bot',
      to: recipient,
      body: messageText,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
      id: result.key?.id || Date.now().toString()
    };

    messageStore.add(sentMessage);

    res.status(200).json({ success: true, message: sentMessage });
  } catch (error) {
    console.error('POST /api/messages error:', error);
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
  const messages = messageStore.getByPhone(req.params.phone);
  res.json({ messages, count: messages.length });
});

// GET /api/contacts - Lista contatos únicos das mensagens
app.get('/api/contacts', authJWT, (req, res) => {
  const messages = messageStore.getAll();
  const contactMap = new Map();

  messages.forEach(msg => {
    const phone = msg.direction === 'outgoing' ? msg.to : msg.from;
    if (phone && phone !== 'bot') {
      if (!contactMap.has(phone)) {
        contactMap.set(phone, {
          phone,
          name: msg.customerName || phone,
          lastMessage: msg.body,
          lastMessageTime: msg.timestamp,
          unread: 0
        });
      } else {
        const contact = contactMap.get(phone);
        contact.lastMessage = msg.body;
        contact.lastMessageTime = msg.timestamp;
      }
    }
  });

  const contacts = Array.from(contactMap.values())
    .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

  res.json({ contacts, count: contacts.length });
});

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
    const phoneInfo = await sock.onWhatsApp(`${formatPhone(telefone)}@s.whatsapp.net`);
    res.json({
      sendResult: result,
      phoneExists: phoneInfo,
      connectionState: {
        isConnected: whatsappService.isConnected,
        user: sock.user?.id,
        platform: sock.user?.platform
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

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Health check: http://localhost:${PORT}/health`);
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
