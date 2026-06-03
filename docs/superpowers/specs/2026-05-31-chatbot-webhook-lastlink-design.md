# Design: ChatBot Webhook LastLink + WhatsApp

## Visão Geral

Sistema de ChatBot que recebe notificações de abertura de carrinho via webhook da LastLink e envia mensagens de follow-up via WhatsApp usando Baileys (WhatsApp Web.js).

## Objetivos

- Receber webhook da LastLink quando cliente abre carrinho
- Enviar mensagem de texto via WhatsApp para o telefone do checkout
- Manter sessão WhatsApp ativa permanentemente
- MVP básico com autenticação via token fixo

## Arquitetura

```
┌─────────────┐    POST     ┌─────────────────┐    Baileys    ┌────────────┐
│   LastLink  │ ──────────► │  Servidor Node  │ ────────────► │  WhatsApp  │
│   Webhook   │             │  (Express)      │               │  Web       │
└─────────────┘             └─────────────────┘               └────────────┘
                                    │
                                    ▼
                            ┌───────────────┐
                            │  Sessão Local │
                            │  (auth_info)  │
                            └───────────────┘
```

## Componentes

### 1. Servidor Express (src/server.js)

- Porta configurável via variável de ambiente
- Rota POST `/webhook` para receber notificações da LastLink
- Rota GET `/health` para verificação de saúde
- Middleware de autenticação via header

### 2. Middleware de Autenticação (src/middleware/auth.js)

- Valida header `Authorization: Bearer <TOKEN>`
- Token configurado via variável de ambiente `WEBHOOK_TOKEN`
- Retorna 401 se inválido

### 3. Handler de Webhook (src/handlers/webhook.js)

- Extrai dados do corpo da requisição: `{ nome, telefone, produto }`
- Valida campos obrigatórios
- Chama serviço WhatsApp para enviar mensagem
- Retorna status 200 ou erro

### 4. Serviço WhatsApp (src/services/whatsapp.js)

- Inicializa Baileys com armazenamento local
- Gerencia conexão e reconexão automática
- Envia mensagens de texto
- Armazena sessão em `./auth_info`

### 5. Template de Mensagem (src/templates/message.js)

- Formata mensagem com nome e produto
- Template simples de texto

## Fluxo de Dados

### Request do Webhook

```json
POST /webhook
Headers:
  Authorization: Bearer <WEBHOOK_TOKEN>
  Content-Type: application/json

Body:
{
  "nome": "João Silva",
  "telefone": "5511999999999",
  "produto": "Curso Online XYZ"
}
```

### Validação

1. Verificar header de autorização
2. Validar presença de `nome`, `telefone`, `produto`
3. Formatar telefone para formato WhatsApp:
   - Remover caracteres não numéricos (parênteses, traços, espaços)
   - Adicionar código do país `55` se não presente
   - Exemplo: `(11) 99999-9999` → `5511999999999`

### Envio WhatsApp

```javascript
// Formato da mensagem
const mensagem = `Olá ${nome}! 👋

Notamos que você deixou o produto ${produto} no carrinho.

Precisa de ajuda? Estamos aqui para você!

Responda esta mensagem para falar conosco.`;

// Envio via Baileys
await socket.sendMessage(`${telefone}@s.whatsapp.net`, { text: mensagem });
```

## Variáveis de Ambiente

```env
# Servidor
PORT=3000

# Autenticação
WEBHOOK_TOKEN=seu_token_secreto_aqui

# WhatsApp
SESSION_DIR=./auth_info
```

## Estrutura de Diretórios

```
webhook-chatbot/
├── src/
│   ├── server.js
│   ├── middleware/
│   │   └── auth.js
│   ├── handlers/
│   │   └── webhook.js
│   ├── services/
│   │   └── whatsapp.js
│   └── templates/
│       └── message.js
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-31-chatbot-webhook-lastlink-design.md
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Tratamento de Erros

### Erros de Validação

- 400 Bad Request: Campos obrigatórios ausentes
- 401 Unauthorized: Token inválido

### Erros de Envio

- 500 Internal Server Error: Falha no envio WhatsApp
- Log detalhado do erro para debug

### Reconexão

- Baileys reconecta automaticamente
- Log de status de conexão
- Fila de mensagens para envio posterior (MVP simplificado)

## Segurança

- Token de autenticação em variável de ambiente
- Não expor dados sensíveis em logs
- Rate limiting básico (futuro)

## Dependências

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.0",
    "express": "^4.18.2",
    "dotenv": "^16.3.1",
    "pino": "^8.17.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  }
}
```

## Critérios de Aceite

1. ✅ Webhook recebe dados da LastLink
2. ✅ Validação de autenticação funciona
3. ✅ Mensagem enviada via WhatsApp com nome e produto
4. ✅ Sessão WhatsApp persiste após reinicialização
5. ✅ Tratamento de erros básico implementado

## Fora do Escopo (MVP)

- Dashboard de monitoramento
- Retry automático de falhas
- Múltiplos produtos
- Botões interativos
- Webhook de status de entrega
- Testes automatizados

## Próximos Passos (Pós-MVP)

1. Adicionar fila de mensagens (Bull/Redis)
2. Implementar retry com backoff exponencial
3. Dashboard de monitoramento
4. Testes unitários e de integração
5. Deploy automatizado via GitHub Actions
