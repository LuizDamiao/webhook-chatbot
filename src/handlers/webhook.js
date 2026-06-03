import { formatCartMessage } from '../templates/message.js';
import { WhatsAppService } from '../services/whatsapp.js';
import { trackMessage } from '../utils/tracker.js';

const whatsappService = new WhatsAppService(process.env.SESSION_DIR);

whatsappService.connect().catch(err => {
  console.error('Failed to connect WhatsApp:', err);
});

/**
 * Handle webhook request from LastLink
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
export async function handleWebhook(req, res) {
  const { nome, telefone, produto } = req.body;

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
}

export { whatsappService };


