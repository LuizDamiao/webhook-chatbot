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

// Parse JSON bodies
app.use(express.json({ limit: '100kb' }));

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
      sessionDir: process.env.SESSION_DIR || './auth_info'
    },
    messages: getStats()
  });
});

// API: Webhook endpoint (returns JSON for dashboard)
app.post('/api/webhook', async (req, res) => {
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

// Webhook endpoint with authentication (original)
app.post('/webhook', authMiddleware, handleWebhook);

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
