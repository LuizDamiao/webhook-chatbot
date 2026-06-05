import { formatCartMessage } from '../templates/message.js';
import { WhatsAppService } from '../services/whatsapp.js';
import { trackMessage } from '../utils/tracker.js';
import { messageStore } from '../services/messageStore.js';
import { templateService } from '../services/templateService.js';

const whatsappService = new WhatsAppService(process.env.SESSION_DIR);

console.log('[INIT] Starting WhatsApp connection...');
whatsappService.connect().then(() => {
  console.log('[INIT] WhatsApp connect() resolved');
}).catch(err => {
  console.error('[INIT] Failed to connect WhatsApp:', err.message, err.stack);
});

/**
 * Clean phone number from LastLink format (+5500987645312 → 5500987645312)
 * @param {string} phone - Raw phone number
 * @returns {string} Cleaned phone number
 */
function cleanPhone(phone) {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Parse LastLink webhook data into our format
 * @param {object} body - Raw webhook body
 * @returns {object} Parsed data { nome, telefone, produto }
 */
function parseLastLinkData(body) {
  // LastLink format
  if (body.Data?.Buyer) {
    const buyer = body.Data.Buyer;
    const products = body.Data.Products || [];

    const nome = buyer.Name;
    const telefone = cleanPhone(buyer.PhoneNumber);

    // Join product names (filter out ones without price, e.g. subscriptions)
    const productNames = products
      .filter(p => p.Name && p.Price)
      .map(p => p.Name);
    const produto = productNames.join(', ') || 'Produtos';

    return {
      nome,
      telefone,
      produto,
      event: body.Event || 'Abandoned_Cart'
    };
  }

  // Legacy format (direct fields)
  return {
    nome: body.nome,
    telefone: body.telefone,
    produto: body.produto,
    event: 'Abandoned_Cart'
  };
}

/**
 * Handle webhook request from LastLink
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
export async function handleWebhook(req, res, data) {
  const { nome, telefone, produto, event } = parseLastLinkData(req.body);

  // Validate required fields
  if (!nome || !telefone || !produto) {
    return res.status(400).json({
      error: 'Missing required fields: nome, telefone, produto'
    });
  }

  if (!whatsappService.isConnected) {
    return res.status(503).json({ error: 'WhatsApp not connected' });
  }

  try {
    const template = templateService.getTemplate(event);
    const message = template
      ? templateService.renderTemplate(template.message, {
          nome: nome.normalize('NFC'),
          produto: produto.normalize('NFC'),
          preco: produto,
          email: req.body.Data?.Buyer?.Email || '',
          oferta: req.body.Data?.Offer?.Url || ''
        })
      : formatCartMessage(nome.normalize('NFC'), produto.normalize('NFC'));
    const result = await whatsappService.sendMessage(telefone, message);

    trackMessage(nome, telefone, result.success);

    if (result.success) {
      messageStore.add({
        from: 'bot',
        to: telefone,
        body: message,
        direction: 'outgoing',
        status: 'sent',
        type: 'text',
        customerName: nome,
        products: produto
      });
      res.status(200).json({ success: true });
    } else {
      console.error('WhatsApp send failed:', result.error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
}

export { whatsappService, parseLastLinkData };


