import { formatCartMessage } from '../templates/message.js';
import { WhatsAppService } from '../services/whatsapp.js';

const whatsappService = new WhatsAppService(process.env.SESSION_DIR);

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

  try {
    // Format message
    const message = formatCartMessage(nome, produto);

    // Send WhatsApp message
    const result = await whatsappService.sendMessage(telefone, message);

    if (result.success) {
      res.status(200).json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to send message' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
}

export { whatsappService };
