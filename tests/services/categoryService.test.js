import { categoryService } from '../../src/services/categoryService.js';

describe('CategoryService', () => {
  beforeEach(async () => {
    await categoryService.load();
  });

  describe('matchProduct', () => {
    it('should return category for known product', () => {
      expect(categoryService.matchProduct('E-book Marketing Digital')).toBe('ebook');
    });

    it('should return category for product with keyword "guia"', () => {
      expect(categoryService.matchProduct('Guia Completo de Python')).toBe('ebook');
    });

    it('should return category for product with keyword "curso"', () => {
      expect(categoryService.matchProduct('Curso de JavaScript')).toBe('curso');
    });

    it('should return category for product with keyword "consultoria"', () => {
      expect(categoryService.matchProduct('Consultoria Financeira')).toBe('consultoria');
    });

    it('should return default for unknown product', () => {
      expect(categoryService.matchProduct('Produto Desconhecido')).toBe('default');
    });

    it('should match case-insensitive', () => {
      expect(categoryService.matchProduct('EBOOK em PDF')).toBe('ebook');
    });
  });

  describe('getCategories', () => {
    it('should return array with length > 0', () => {
      const categories = categoryService.getCategories();
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
    });

    it('should include default category', () => {
      const categories = categoryService.getCategories();
      expect(categories).toContain('default');
    });
  });

  describe('addCategory', () => {
    it('should add new category', async () => {
      await categoryService.addCategory('newcategory', ['keyword1', 'keyword2']);
      const categories = categoryService.getCategories();
      expect(categories).toContain('newcategory');
    });
  });
});