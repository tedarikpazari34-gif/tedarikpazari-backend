import { AuthService } from './auth.service';

describe('Email verification security', () => {
  const createService = (users: any) =>
    new AuthService(
      { user: users } as any,
      {} as any, {} as any, {} as any,
      {} as any, {} as any,
    );

  it('consumes the token atomically', async () => {
    const users = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'u1',
        emailVerificationExpiresAt: new Date(Date.now() + 60000),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    await expect(createService(users).verifyEmail('test-token'))
      .resolves.toEqual({
        message: 'E-posta adresiniz doğrulandı',
        emailVerified: true,
      });

    expect(users.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'u1',
        emailVerificationToken: 'test-token',
        emailVerificationExpiresAt: { gt: expect.any(Date) },
      },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
      },
    });
  });

  it('rejects a token already consumed by another request', async () => {
    const users = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'u1',
        emailVerificationExpiresAt: new Date(Date.now() + 60000),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    await expect(createService(users).verifyEmail('used-token'))
      .rejects.toThrow('Doğrulama bağlantısı geçersiz veya süresi dolmuş');
  });
});
