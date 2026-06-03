import 'dotenv/config';
import express from 'express';
import { authMiddleware } from './middleware/auth.js';
import { handleWebhook } from './handlers/webhook.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json({ limit: '100kb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook endpoint with authentication
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
