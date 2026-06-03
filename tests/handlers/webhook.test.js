import { jest } from '@jest/globals';

const mockSendMessage = jest.fn().mockResolvedValue({ success: true });
const mockIsConnected = { value: true };

jest.unstable_mockModule('../../src/templates/message.js', () => ({
  formatCartMessage: jest.fn().mockReturnValue('Mocked message')
}));

jest.unstable_mockModule('../../src/services/whatsapp.js', () => ({
  WhatsAppService: jest.fn().mockImplementation(() => ({
    get isConnected() { return mockIsConnected.value; },
    connect: jest.fn().mockResolvedValue(undefined),
    sendMessage: mockSendMessage
  }))
}));

const { handleWebhook } = await import('../../src/handlers/webhook.js');

describe('handleWebhook', () => {
  let req, res;

  beforeEach(() => {
    mockSendMessage.mockReset().mockResolvedValue({ success: true });
    mockIsConnected.value = true;
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
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields: nome, telefone, produto' });
  });

  it('should return 400 if produto is missing', async () => {
    req.body.produto = null;
    await handleWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields: nome, telefone, produto' });
  });

  it('should return 503 if WhatsApp is not connected', async () => {
    mockIsConnected.value = false;
    await handleWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'WhatsApp not connected' });
  });

  it('should return 500 if sendMessage throws', async () => {
    mockSendMessage.mockRejectedValue(new Error('Connection failed'));

    await handleWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to send message' });
  });

  it('should return 500 if sendMessage returns success false', async () => {
    mockSendMessage.mockResolvedValue({ success: false, error: 'Not connected' });

    await handleWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to send message' });
  });
});
