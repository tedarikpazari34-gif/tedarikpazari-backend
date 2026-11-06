import { getJwtSecret } from './jwt-secret';

describe('JWT secret configuration security', () => {
  const previous = process.env.JWT_SECRET;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previous;
    }
  });

  it('rejects a missing JWT secret', () => {
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow('JWT_SECRET');
  });

  it('rejects a blank JWT secret', () => {
    process.env.JWT_SECRET = '   ';
    expect(() => getJwtSecret()).toThrow('JWT_SECRET');
  });

  it('rejects a short JWT secret', () => {
    process.env.JWT_SECRET = 'too-short';
    expect(() => getJwtSecret()).toThrow('JWT_SECRET');
  });

  it('accepts a configured strong JWT secret unchanged', () => {
    const value = 'a'.repeat(64);
    process.env.JWT_SECRET = value;
    expect(getJwtSecret()).toBe(value);
  });
});
