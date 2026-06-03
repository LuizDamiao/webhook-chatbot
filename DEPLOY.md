# Guia de Deployment

## Visão Geral

O projeto possui duas partes:
- **Frontend (Dashboard)**: Hospedado no GitHub Pages (gratuito)
- **Backend (API)**: Hospedado no Render.com (gratuito)

## Pré-requisitos

- Conta no GitHub (gratuita)
- Conta no Render.com (gratuita)
- Git instalado

## 1. Criar Repositório no GitHub

1. Acesse github.com
2. Clique em "New repository"
3. Nome: `webhook-chatbot`
4. Seja público
5. Clique em "Create repository"

## 2. Enviar Código para GitHub

```bash
cd "E:\ECOM\2026\PROJETOS\NOVO PROJETO\WEBHOOK"
git remote add origin https://github.com/SEU_USUARIO/webhook-chatbot.git
git branch -M main
git push -u origin main
```

## 3. Deploy do Backend no Render.com

### 3.1 Criar Conta
1. Acesse render.com
2. Clique em "Get Started for Free"
3. Crie conta com GitHub

### 3.2 Criar Web Service
1. Clique em "New +" → "Web Service"
2. Conecte seu repositório GitHub
3. Configure:
   - **Name**: webhook-chatbot
   - **Region**: Oregon (US West)
   - **Branch**: main
   - **Build Command**: `npm install`
   - **Start Command**: `node src/server.js`
   - **Plan**: Free

### 3.3 Variáveis de Ambiente
Adicione em "Environment Variables":

| Variável | Valor | Descrição |
|----------|-------|-----------|
| `NODE_ENV` | production | Modo produção |
| `WEBHOOK_TOKEN` | (gere um token) | Token de autenticação |
| `SESSION_DIR` | /data/auth_info | Diretório de sessão |
| `PORT` | 10000 | Porta do servidor |

### 3.4 Disk (Para Sessão WhatsApp)
1. Em "Disks", adicione:
   - **Name**: whatsapp-session
   - **Mount Path**: /data
   - **Size**: 1 GB

### 3.5 Deploy
1. Clique em "Create Web Service"
2. Aguarde o build (2-3 minutos)
3. Anote a URL (ex: `https://webhook-chatbot.onrender.com`)

## 4. Deploy do Frontend no GitHub Pages

### 4.1 Ativar GitHub Pages
1. No repositório GitHub, vá em "Settings" → "Pages"
2. Em "Source", selecione "GitHub Actions"
3. Salve

### 4.2 Atualizar URL do Backend
1. Edite `public/js/app.js`
2. Atualize a linha:
```javascript
: 'https://webhook-chatbot.onrender.com'; // Sua URL do Render
```
3. Faça push:
```bash
git add .
git commit -m "feat: update backend URL for production"
git push
```

### 4.3 Acessar Dashboard
1. Acesse: `https://SEU_USUARIO.github.io/webhook-chatbot/`
2. O dashboard mostrará o status do backend

## 5. Conectar WhatsApp

1. Acesse o dashboard
2. Clique em "Testar Webhook" para verificar conexão
3. O QR Code aparecerá nos logs do Render.com
4. Acesse: Render.com → Seu Service → Logs
5. Escaneie o QR Code com o WhatsApp

## 6. Configurar LastLink

### 6.1 Webhook URL
Configure na LastLink:
```
POST https://webhook-chatbot.onrender.com/webhook
Headers:
  Authorization: Bearer SEU_TOKEN_AQUI
  Content-Type: application/json
```

### 6.2 Formato do Payload
```json
{
  "nome": "{{customer.name}}",
  "telefone": "{{customer.phone}}",
  "produto": "{{product.name}}"
}
```

## 7. Testar

### 7.1 Testar Health Check
```bash
curl https://webhook-chatbot.onrender.com/health
```

### 7.2 Testar Webhook
```bash
curl -X POST https://webhook-chatbot.onrender.com/webhook \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nome": "Teste", "telefone": "11999999999", "produto": "Produto Teste"}'
```

## Solução de Problemas

### WhatsApp não conecta
- Verifique os logs no Render.com
- O QR Code expira rapidamente
- Reinicie o serviço se necessário

### Dashboard não carrega
- Verifique se o backend está online
- Verifique a URL do backend em `public/js/app.js`
- Verifique o console do navegador

### Webhook retorna erro
- Verifique o token de autenticação
- Verifique o formato do payload
- Verifique os logs no Render.com

## URLs Importantes

| Serviço | URL |
|---------|-----|
| Dashboard | https://SEU_USUARIO.github.io/webhook-chatbot/ |
| Backend API | https://webhook-chatbot.onrender.com |
| Health Check | https://webhook-chatbot.onrender.com/health |
| Webhook | https://webhook-chatbot.onrender.com/webhook |

## Custos

| Serviço | Plano | Custo |
|---------|-------|-------|
| GitHub Pages | Free | $0 |
| Render.com | Free | $0 |
| **Total** | - | **$0** |

## Limitações do Plano Gratuito

### Render.com
- Servidor dorme após 15 minutos de inatividade
- Primeira requisição após dormir pode levar 30-60 segundos
- 750 horas/mês de execução

### GitHub Pages
- 1GB de armazenamento
- 100GB de transferência/mês

## Upgrade (Opcional)

Se precisar de mais performance:
- **Render.com**: Plano Starter ($7/mês) - Sem dormir
- **Vercel**: Plano Pro ($20/mês) - Melhor performance
