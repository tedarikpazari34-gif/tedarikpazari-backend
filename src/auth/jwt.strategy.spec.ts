import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy security', () => {
  const previousSecret = process.env.JWT_SECRET;
  const users = {
    findUnique: jest.fn(),
  };

  let strategy: JwtStrategy;

  beforeAll(() => {
    process.env.JWT_SECRET = 'a'.repeat(64);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy({ user: users } as any);
  });

  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  });

  it('rejects tokens without a user identity', async () => {
    await expect(strategy.validate({})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.findUnique).not.toHaveBeenCalled();
  });

  it('rejects deleted users', async () => {
    users.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'deleted-user' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects users without a company', async () => {
    users.findUnique.mockResolvedValue({
      id: 'u1',
      companyId: 'c1',
      company: null,
    });

    await expect(
      strategy.validate({ sub: 'u1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses current database company role instead of token role', async () => {
    users.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'test@example.com',
      companyId: 'c1',
      sessionVersion: 0,
      company: {
        role: 'SELLER',
        status: 'APPROVED',
      },
    });

    const result = await strategy.validate({
      sub: 'u1',
      role: 'ADMIN',
      companyId: 'other-company',
      sessionVersion: 0,
    });

    expect(result.role).toBe('SELLER');
    expect(result.companyId).toBe('c1');
    expect(users.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      include: { company: true },
    });
  });

  it('rejects tokens with an outdated session version', async () => {
    users.findUnique.mockResolvedValue({
      id: 'u1',
      companyId: 'c1',
      sessionVersion: 2,
      company: { role: 'BUYER', status: 'APPROVED' },
    });

    await expect(
      strategy.validate({ sub: 'u1', sessionVersion: 1 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a matching session version', async () => {
    users.findUnique.mockResolvedValue({
      id: 'u1',
      companyId: 'c1',
      sessionVersion: 2,
      company: { role: 'BUYER', status: 'APPROVED' },
    });

    const result = await strategy.validate({
      sub: 'u1',
      sessionVersion: 2,
    });

    expect(result.id).toBe('u1');
    expect(result.role).toBe('BUYER');
  });

  it('rejects tokens missing a session version', async () => {
    users.findUnique.mockResolvedValue({
      id: 'u1',
      companyId: 'c1',
      sessionVersion: 0,
      company: { role: 'BUYER', status: 'APPROVED' },
    });

    await expect(
      strategy.validate({ sub: 'u1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

});
