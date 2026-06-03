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