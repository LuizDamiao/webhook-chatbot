import { formatPhone } from '../../src/services/whatsapp.js';

describe('formatPhone', () => {
  it('should add country code 55 if not present', () => {
    expect(formatPhone('11999999999')).toBe('5511999999999');
  });

  it('should keep country code if already present', () => {
    expect(formatPhone('5511999999999')).toBe('5511999999999');
  });

  it('should remove non-numeric characters', () => {
    expect(formatPhone('(11) 99999-9999')).toBe('5511999999999');
  });

  it('should throw error if phone is empty', () => {
    expect(() => formatPhone('')).toThrow('Invalid phone number');
  });

  it('should throw error if phone is null', () => {
    expect(() => formatPhone(null)).toThrow('Invalid phone number');
  });

  it('should throw error if phone is too short', () => {
    expect(() => formatPhone('123')).toThrow('Invalid phone number');
  });

  it('should throw error if phone is too long', () => {
    expect(() => formatPhone('5511999999999999')).toThrow('Invalid phone number');
  });
});
