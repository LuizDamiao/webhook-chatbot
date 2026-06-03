# ChatBot Webhook LastLink + WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a webhook server that receives cart opening notifications from LastLink and sends WhatsApp messages via Baileys.

**Architecture:** Express server with webhook endpoint, authentication middleware, and Baileys WhatsApp integration. Session persisted locally for permanent connection.

**Tech Stack:** Node.js, Express, Baileys (@whiskeysockets/baileys), dotenv, pino

---

## File Structure

```
webhook-chatbot/
├── src/
│   ├── server.js                    # Express server setup and startup
│   ├── middleware/
│   │   └── auth.js                  # Bearer token authentication
│   ├── handlers/
│   │   └── webhook.js               # Webhook request handler
│   ├── services/
│   │   └── whatsapp.js              # Baileys WhatsApp service
│   └── templates/
│       └── message.js               # Message formatting
├── tests/
│   ├── middleware/
│   │   └── auth.test.js             # Auth middleware tests
│   ├── handlers/
│   │   └── webhook.test.js          # Webhook handler tests
│   ├── services/
│   │   └── whatsapp.test.js         # WhatsApp service tests
│   └── templates/
│       └── message.test.js          # Message template tests
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-05-31-chatbot-webhook-lastlink-design.md
│       └── plans/
│           └── 2026-05-31-chatbot-webhook-lastlink-plan.md
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Initialize npm project**

Run: `npm init -y`

- [ ] **Step 2: Install dependencies**

Run: `npm install express dotenv pino @whiskeysockets/baileys`
Run: `npm install --save-dev nodemon jest`

- [ ] **Step 3: Create .gitignore**

```gitignore
node_modules/
auth_info/
.env
*.log
```

- [ ] **Step 4: Create .env.example**

```env
# Server
PORT=3000

# Authentication
WEBHOOK_TOKEN=your_secret_token_here

# WhatsApp
SESSION_DIR=./auth_info
```

- [ ] **Step 5: Update package.json scripts**

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "test": "jest --coverage",
    "test:watch": "jest --watch"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: initialize project with dependencies"
```

---

## Task 2: Message Template

**Files:**
- Create: `src/templates/message.js`
- Create: `tests/templates/message.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/templates/message.test.js
const { formatCartMessage } = require('../../src/templates/message');

describe('formatCartMessage', () => {
  it('should format message with name and product', () => {
    const result = formatCartMessage('João Silva', 'Curso Online XYZ');
    expect(result).toContain('Olá João Silva!');
    expect(result).toContain('Curso Online XYZ');
  });

  it('should throw error if name is missing', () => {
    expect(() => formatCartMessage(null, 'Product')).toThrow('Name is required');
  });

  it('should throw error if product is missing', () => {
    expect(() => formatCartMessage('João', null)).toThrow('Product is required');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/templates/message.test.js`
Expected: FAIL with "Cannot find module '../../src/templates/message'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/templates/message.js

/**
 * Formats a cart abandonment message
 * @param {string} name - Customer name
 * @param {string} product - Product name
 * @returns {string} Formatted message
 */
function formatCartMessage(name, product) {
  if (!name) throw new Error('Name is required');
  if (!product) throw new Error('Product is required');

  return `Olá ${name}! 👋

Notamos que você deixou o produto ${product} no carrinho.

Precisa de ajuda? Estamos aqui para você!

Responda esta mensagem para falar conosco.`;
}

module.exports = { formatCartMessage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/templates/message.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/templates/message.js tests/templates/message.test.js
git commit -m "feat: add message template with validation"
```

---

## Task 3: WhatsApp Service

**Files:**
- Create: `src/services/whatsapp.js`
- Create: `tests/services/whatsapp.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/services/whatsapp.test.js
const { formatPhone } = require('../../src/services/whatsapp');

describe('formatPhone', () => {
  it('should add country code 55 if not present', () => {
    expect(formatPhone('11999999999')).toBe('5511999999999');
  });

  it('should keep country code if already present', () => {
    expect(formatPhone('5511999999999')).toBe('5511999999999');
  });

  it('should remove non-numeric characters', () => {
    expect(formatPhone('(11) 99999-9999')).toBe('5511999999999');
  });

  it('should throw error if phone is invalid', () => {
    expect(() => formatPhone('')).toThrow('Invalid phone number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/whatsapp.test.js`
Expected: FAIL with "Cannot find module '../../src/services/whatsapp'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/services/whatsapp.js
const pino = require('pino');

const logger = pino({ level: 'info' });

/**
 * Formats phone number to WhatsApp format
 * @param {string} phone - Phone number
 * @returns {string} Formatted phone with country code
 */
function formatPhone(phone) {
  if (!phone) throw new Error('Invalid phone number');

  // Remove non-numeric characters
  const cleaned = phone.replace(/\D/g, '');

  // Add country code 55 if not present
  if (cleaned.startsWith('55')) {
    return cleaned;
  }
  return `55${cleaned}`;
}

/**
 * WhatsApp service using Baileys
 */
class WhatsAppService {
  constructor(sessionDir) {
    this.sessionDir = sessionDir || './auth_info';
    this.sock = null;
    this.isConnected = false;
  }

  /**
   * Initialize WhatsApp connection
   */
  async connect() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: logger
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.info('Connection closed:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
        this.isConnected = false;

        if (shouldReconnect) {
          this.connect();
        }
      } else if (connection === 'open') {
        logger.info('WhatsApp connected');
        this.isConnected = true;
      }
    });
  }

  /**
   * Send text message
   * @param {string} phone - Phone number (will be formatted)
   * @param {string} message - Message text
   * @returns {boolean} Success status
   */
  async sendMessage(phone, message) {
    if (!this.sock || !this.isConnected) {
      throw new Error('WhatsApp not connected');
    }

    const formattedPhone = formatPhone(phone);
    const jid = `${formattedPhone}@s.whatsapp.net`;

    try {
      await this.sock.sendMessage(jid, { text: message });
      logger.info(`Message sent to ${formattedPhone}`);
      return true;
    } catch (error) {
      logger.error('Failed to send message:', error);
      throw error;
    }
  }
}

module.exports = { WhatsAppService, formatPhone };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/services/whatsapp.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/whatsapp.js tests/services/whatsapp.test.js
git commit -m "feat: add WhatsApp service with Baileys integration"
```

---

## Task 4: Authentication Middleware

**Files:**
- Create: `src/middleware/auth.js`
- Create: `tests/middleware/auth.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/middleware/auth.test.js
const { authMiddleware } = require('../../src/middleware/auth');

describe('authMiddleware', () => {
  let req, res, next;

  beforeEach(() => {
    process.env.WEBHOOK_TOKEN = 'test_token_123';
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  afterEach(() => {
    delete process.env.WEBHOOK_TOKEN;
  });

  it('should call next if token is valid', () => {
    req.headers.authorization = 'Bearer test_token_123';
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 401 if authorization header is missing', () => {
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('should return 401 if token is invalid', () => {
    req.headers.authorization = 'Bearer wrong_token';
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 if token is missing in header', () => {
    req.headers.authorization = 'Bearer ';
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/middleware/auth.test.js`
Expected: FAIL with "Cannot find module '../../src/middleware/auth'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/middleware/auth.js

/**
 * Authentication middleware for webhook
 * Validates Bearer token from Authorization header
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  const expectedToken = process.env.WEBHOOK_TOKEN;

  if (!token || token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = { authMiddleware };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/middleware/auth.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/middleware/auth.js tests/middleware/auth.test.js
git commit -m "feat: add authentication middleware with token validation"
```

---

## Task 5: Webhook Handler

**Files:**
- Create: `src/handlers/webhook.js`
- Create: `tests/handlers/webhook.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/handlers/webhook.test.js
const { handleWebhook } = require('../../src/handlers/webhook');

jest.mock('../../src/templates/message', () => ({
  formatCartMessage: jest.fn().mockReturnValue('Mocked message')
}));

jest.mock('../../src/services/whatsapp', () => ({
  WhatsAppService: jest.fn().mockImplementation(() => ({
    sendMessage: jest.fn().mockResolvedValue(true)
  }))
}));

describe('handleWebhook', () => {
  let req, res;

  beforeEach(() => {
    req = {
      body: {
        nome: 'João Silva',
        telefone: '11999999999',
        produto: 'Curso Online XYZ'
      }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
  });

  it('should return 200 on successful message send', async () => {
    await handleWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('should return 400 if nome is missing', async () => {
    req.body.nome = null;
    await handleWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields: nome, telefone, produto' });
  });

  it('should return 400 if telefone is missing', async () => {
    req.body.telefone = null;
    await handleWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 if produto is missing', async () => {
    req.body.produto = null;
    await handleWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/handlers/webhook.test.js`
Expected: FAIL with "Cannot find module '../../src/handlers/webhook'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/handlers/webhook.js
const { formatCartMessage } = require('../templates/message');
const { WhatsAppService } = require('../services/whatsapp');

const whatsappService = new WhatsAppService(process.env.SESSION_DIR);

/**
 * Handle webhook request from LastLink
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function handleWebhook(req, res) {
  const { nome, telefone, produto } = req.body;

  // Validate required fields
  if (!nome || !telefone || !produto) {
    return res.status(400).json({
      error: 'Missing required fields: nome, telefone, produto'
    });
  }

  try {
    // Format message
    const message = formatCartMessage(nome, produto);

    // Send WhatsApp message
    await whatsappService.sendMessage(telefone, message);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
}

module.exports = { handleWebhook, whatsappService };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/handlers/webhook.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/handlers/webhook.js tests/handlers/webhook.test.js
git commit -m "feat: add webhook handler with validation"
```

---

## Task 6: Server Setup

**Files:**
- Create: `src/server.js`

- [ ] **Step 1: Create server.js**

```javascript
// src/server.js
require('dotenv').config();

const express = require('express');
const { authMiddleware } = require('./middleware/auth');
const { handleWebhook } = require('./handlers/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook endpoint with authentication
app.post('/webhook', authMiddleware, handleWebhook);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
```

- [ ] **Step 2: Start server to verify it works**

Run: `npm start`
Expected: Server starts on port 3000

- [ ] **Step 3: Test health endpoint**

Run: `curl http://localhost:3000/health`
Expected: `{"status":"ok","timestamp":"2026-05-31T..."}`

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat: add Express server with routes"
```

---

## Task 7: Run All Tests

**Files:**
- None

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Verify coverage**

Run: `npm test -- --coverage`
Expected: Coverage report shows all files covered

- [ ] **Step 3: Commit coverage report**

```bash
git add .
git commit -m "test: verify all tests pass with coverage"
```

---

## Task 8: Final Setup and Documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

```markdown
# ChatBot Webhook LastLink + WhatsApp

Sistema de ChatBot que recebe notificações de abertura de carrinho via webhook da LastLink e envia mensagens de follow-up via WhatsApp.

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure your tokens
4. Start the server: `npm start`

## Environment Variables

- `PORT` - Server port (default: 3000)
- `WEBHOOK_TOKEN` - Secret token for webhook authentication
- `SESSION_DIR` - WhatsApp session directory (default: ./auth_info)

## Webhook Usage

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"nome": "João Silva", "telefone": "11999999999", "produto": "Curso Online XYZ"}'
```

## First Run

On first run, a QR code will appear in the terminal. Scan it with WhatsApp to connect.

## Development

```bash
npm run dev    # Start with nodemon
npm test       # Run tests
npm run test:watch  # Run tests in watch mode
```
```

- [ ] **Step 2: Final commit**

```bash
git add README.md
git commit -m "docs: add README with setup instructions"
```

---

## Summary

- **Task 1:** Project setup with dependencies
- **Task 2:** Message template with validation
- **Task 3:** WhatsApp service with Baileys
- **Task 4:** Authentication middleware
- **Task 5:** Webhook handler
- **Task 6:** Server setup
- **Task 7:** Test verification
- **Task 8:** Documentation

**Total estimated time:** 30-45 minutes
