import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/services/knowledge.js', () => ({
  searchChunks: jest.fn().mockResolvedValue([])
}));

jest.unstable_mockModule('../../src/services/messageStore.js', () => ({
  messageStore: {
    add: jest.fn().mockReturnValue({}),
    getByPhone: jest.fn().mockReturnValue([]),
    getAll: jest.fn().mockReturnValue([]),
    clear: jest.fn()
  }
}));

const { processMessage, getNotifications, resolveNotification, getConfig, setConfig, isEnabled, reset: resetAiAgent } = await import('../../src/services/aiAgent.js');
const { flowEngine } = await import('../../src/services/flowEngine.js');
const { searchChunks } = await import('../../src/services/knowledge.js');
const { messageStore } = await import('../../src/services/messageStore.js');

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('AiAgent', () => {
  beforeEach(() => {
    flowEngine.reset();
    resetAiAgent();
    messageStore.clear();
    mockFetch.mockReset();
    searchChunks.mockResolvedValue([]);
    process.env.GROQ_API_KEY = 'test-api-key';
    setConfig('enabled', 'true');
  });

  describe('isEnabled', () => {
    it('should return true by default', () => {
      expect(isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      setConfig('enabled', 'false');
      expect(isEnabled()).toBe(false);
    });
  });

  describe('getConfig / setConfig', () => {
    it('should store and retrieve config values', () => {
      setConfig('test_key', 'test_value');
      expect(getConfig('test_key')).toBe('test_value');
    });

    it('should return null for unknown keys', () => {
      expect(getConfig('unknown')).toBeNull();
    });
  });

  describe('getNotifications', () => {
    it('should return empty array initially', () => {
      expect(getNotifications()).toEqual([]);
    });
  });

  describe('processMessage', () => {
    it('should return null when AI is disabled', async () => {
      setConfig('enabled', 'false');
      const result = await processMessage('5511999999999', 'Olá');
      expect(result).toBeNull();
    });

    it('should process message and return response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Olá! Como posso ajudar?' } }]
        })
      });

      const result = await processMessage('5511999999999', 'Olá');
      expect(result).toBeDefined();
      expect(result.response).toBe('Olá! Como posso ajudar?');
      expect(result.phase).toBe('attention');
      expect(result.needsHuman).toBe(false);
    });

    it('should detect phase change', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Entendo sua dor.' } }]
        })
      });

      const result = await processMessage('5511999999999', 'Minha perna dói muito');
      expect(result.phase).toBe('interest');
    });

    it('should mark needsHuman when response contains indicators', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Deixa eu verificar com a equipe.' } }]
        })
      });

      const result = await processMessage('5511999999999', 'Dúvida');
      expect(result.needsHuman).toBe(true);
    });

    it('should create notification when needsHuman', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Não tenho certeza.' } }]
        })
      });

      await processMessage('5511999999999', 'Teste');
      const notifications = getNotifications();
      expect(notifications.length).toBe(1);
    });

    it('should return fallback response when GROQ_API_KEY not set', async () => {
      delete process.env.GROQ_API_KEY;
      const result = await processMessage('5511999999999', 'Olá');
      expect(result).not.toBeNull();
      expect(result.response).toBe('Oi, querida! 😊 Sou a Carina, fisioterapeuta especializada em saúde da mulher. Como posso te ajudar?');
      expect(result.phase).toBe('attention');
      expect(result.needsHuman).toBe(false);
    });

    it('should store AI response in messageStore', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Resposta testada' } }]
        })
      });

      await processMessage('5511999999999', 'Olá');
      expect(messageStore.add).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Resposta testada',
          direction: 'outgoing'
        })
      );
    });
  });

  describe('resolveNotification', () => {
    it('should mark notification as resolved', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Transferir' } }]
        })
      });

      await processMessage('5511999999999', 'Teste');
      const notifications = getNotifications();
      expect(notifications.length).toBe(1);

      resolveNotification(notifications[0].id);
      expect(getNotifications().length).toBe(0);
    });
  });
});
