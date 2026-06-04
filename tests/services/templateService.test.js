import { TemplateService } from '../../src/services/templateService.js';

describe('TemplateService', () => {
  let service;

  beforeEach(() => {
    service = new TemplateService();
    service.reset();
  });

  describe('getTemplate', () => {
    it('should return template for known event', () => {
      const tpl = service.getTemplate('Abandoned_Cart');
      expect(tpl).not.toBeNull();
      expect(tpl.message).toContain('{nome}');
      expect(tpl.category).toBe('default');
    });

    it('should return null for unknown event', () => {
      expect(service.getTemplate('Unknown_Event')).toBeNull();
    });
  });

  describe('renderTemplate', () => {
    it('should replace variables correctly', () => {
      const result = service.renderTemplate(
        'Olá {nome}! Você comprou {produto} por {preco}.',
        { nome: 'João', produto: 'Notebook', preco: 'R$ 3.000' }
      );
      expect(result).toBe('Olá João! Você comprou Notebook por R$ 3.000.');
    });

    it('should keep unmatched variables as-is', () => {
      const result = service.renderTemplate(
        'Olá {nome}! Seu código é {codigo}.',
        { nome: 'Maria' }
      );
      expect(result).toBe('Olá Maria! Seu código é {codigo}.');
    });
  });

  describe('getTemplateByCategory', () => {
    it('should return template matching event and category', () => {
      const tpl = service.getTemplateByCategory('Abandoned_Cart', 'default');
      expect(tpl).not.toBeNull();
      expect(tpl.category).toBe('default');
    });

    it('should return null if category does not match', () => {
      const tpl = service.getTemplateByCategory('Abandoned_Cart', 'vip');
      expect(tpl).toBeNull();
    });

    it('should return null for unknown event', () => {
      const tpl = service.getTemplateByCategory('Unknown_Event', 'default');
      expect(tpl).toBeNull();
    });
  });

  describe('updateTemplate', () => {
    it('should update an existing template', () => {
      const updated = service.updateTemplate('Abandoned_Cart', {
        message: 'Novo texto {nome}'
      });
      expect(updated.message).toBe('Novo texto {nome}');
      expect(service.getTemplate('Abandoned_Cart').message).toBe('Novo texto {nome}');
    });

    it('should create a new template if event does not exist', () => {
      const created = service.updateTemplate('New_Event', {
        message: 'Teste {x}',
        category: 'custom'
      });
      expect(created.message).toBe('Teste {x}');
      expect(service.getTemplate('New_Event')).not.toBeNull();
    });
  });

  describe('getAllTemplates', () => {
    it('should return all templates', () => {
      const all = service.getAllTemplates();
      expect(Object.keys(all).length).toBeGreaterThanOrEqual(4);
      expect(all.Abandoned_Cart).toBeDefined();
      expect(all.Purchase_Order_Confirmed).toBeDefined();
    });
  });
});
