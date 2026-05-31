import { formatCartMessage } from '../../src/templates/message.js';

describe('formatCartMessage', () => {
  it('should format message with name and product', () => {
    const result = formatCartMessage('João Silva', 'Curso Online XYZ');
    expect(result).toContain('Olá João Silva!');
    expect(result).toContain('Curso Online XYZ');
  });

  it('should throw error if name is missing', () => {
    expect(() => formatCartMessage(null, 'Product')).toThrow('Name is required');
  });

  it('should throw error if product is missing', () => {
    expect(() => formatCartMessage('João', null)).toThrow('Product is required');
  });
});
