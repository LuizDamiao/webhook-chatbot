import 'dotenv/config';

if (!process.env.WEBHOOK_TOKEN) {
  console.error('WEBHOOK_TOKEN environment variable is required');
  process.exit(1);
}

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { authMiddleware } from './middleware/auth.js';
import { handleWebhook, whatsappService } from './handlers/webhook.js';
import { getStats, getLogs, trackMessage } from './utils/tracker.js';
import { formatPhone } from './services/whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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

const webhookLog = [];
const MAX_WEBHOOK_LOG = 20;

// Serve static files from public folder
app.use(express.static(join(__dirname, '../public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API: Server and WhatsApp status
app.get('/api/status', (req, res) => {
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
      sessionDir: process.env.SESSION_DIR || './auth_info'
    },
    messages: getStats()
  });
});

// API: Get QR code for WhatsApp connection
app.get('/api/qrcode', (req, res) => {
  const qr = whatsappService.getQRCode();
  if (qr) {
    res.json({ qr });
  } else {
    res.json({ qr: null, message: 'No QR code available. WhatsApp might be connected or not started yet.' });
  }
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
    timestamp: new Date().toISOString(),
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

  const { nome, telefone, produto } = req.body;

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

// Webhook endpoint with authentication (original)
app.post('/webhook', authMiddleware, (req, res, next) => {
  const entry = {
    timestamp: new Date().toISOString(),
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
  next();
}, handleWebhook);

// API: Raw webhook log (what LastLink sent)
app.get('/api/webhook-raw', (req, res) => {
  res.json({ count: webhookLog.length, webhooks: webhookLog });
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

export default app;
