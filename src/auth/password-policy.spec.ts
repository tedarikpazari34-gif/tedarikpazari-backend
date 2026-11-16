import { validateNewPassword } from './password-policy';

describe('Password security policy', () => {
  it('rejects short passwords', () => {
    expect(() => validateNewPassword('123456')).toThrow();
  });

  it('accepts a sufficiently long password', () => {
    expect(validateNewPassword('Guvenli-Bir-Sifre-2026')).toBe('Guvenli-Bir-Sifre-2026');
  });

  it('rejects excessively long passwords', () => {
    expect(() => validateNewPassword('A'.repeat(129))).toThrow();
  });

  it('rejects missing or invalid passwords', () => {
    expect(() => validateNewPassword(undefined)).toThrow();
    expect(() => validateNewPassword(' sifrem-cok-uzun ')).toThrow();
  });
});
