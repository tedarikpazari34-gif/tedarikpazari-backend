import { AuthService } from './auth.service';

describe('Password reset security', () => {
  it('has an authentication service', () => {
    expect(typeof AuthService).toBe('function');
  });

  it('returns the same response for registered and unknown emails', async () => {
    const users = {
      findUnique: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'u1',
          email: 'owner@example.com',
        }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    const mail = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthService(
      { user: users } as any,
      {} as any,
      {} as any,
      {} as any,
      mail as any,
      {} as any,
    );

    const unknown = await service.requestPasswordReset(
      'unknown@example.com',
    );
    const registered = await service.requestPasswordReset(
      'owner@example.com',
    );

    expect(unknown).toEqual(registered);
    expect(JSON.stringify(unknown)).not.toContain('owner@example.com');
    expect(JSON.stringify(registered)).not.toContain('token');
  });
  it('stores only a SHA-256 hash of the reset token', async () => {
    const crypto = await import('crypto');
    const users = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'owner@example.com',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const mail = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthService(
      { user: users } as any,
      {} as any,
      {} as any,
      {} as any,
      mail as any,
      {} as any,
    );

    await service.requestPasswordReset('owner@example.com');

    expect(users.updateMany).toHaveBeenCalledTimes(1);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);

    const stored = users.updateMany.mock.calls[0][0].data;
    const emailText = mail.sendMail.mock.calls[0][0].text;
    const token = new URL(emailText.match(/https?:\/\/\S+/)![0])
      .searchParams.get('token');

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.passwordResetTokenHash).toBe(
      crypto.createHash('sha256').update(token!).digest('hex'),
    );
    expect(stored.passwordResetTokenHash).not.toBe(token);
    expect(stored).not.toHaveProperty('passwordResetToken');
  });
  it('sets reset token expiry to 30 minutes', async () => {
    const users = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'owner@example.com',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    const mail = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthService(
      { user: users } as any,
      {} as any,
      {} as any,
      {} as any,
      mail as any,
      {} as any,
    );

    const before = Date.now();
    await service.requestPasswordReset('owner@example.com');
    const after = Date.now();

    const data = users.updateMany.mock.calls[0][0].data;
    const expiry = data.passwordResetExpiresAt;

    expect(expiry).toBeInstanceOf(Date);
    expect(expiry.getTime()).toBeGreaterThanOrEqual(
      before + 30 * 60 * 1000,
    );
    expect(expiry.getTime()).toBeLessThanOrEqual(
      after + 30 * 60 * 1000,
    );
  });
  it('rejects expired reset tokens', async () => {
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256')
      .update(token).digest('hex');

    const users = {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
    };

    const service = new AuthService(
      { user: users } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.resetPassword(token, 'New-Secure-Password-2026'),
    ).rejects.toThrow();

    expect(users.findFirst).toHaveBeenCalledWith({
      where: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { gt: expect.any(Date) },
      },
    });
    expect(users.updateMany).not.toHaveBeenCalled();
  });
  it('rejects invalid or previously used tokens', async () => {
    const users = {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
    };

    const service = new AuthService(
      { user: users } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const password = 'New-Secure-Password-2026';

    await expect(
      service.resetPassword('invalid-token', password),
    ).rejects.toThrow('Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş');

    expect(users.findFirst).not.toHaveBeenCalled();

    const validFormatButUsed = 'a'.repeat(64);

    await expect(
      service.resetPassword(validFormatButUsed, password),
    ).rejects.toThrow('Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş');

    expect(users.findFirst).toHaveBeenCalledTimes(1);
    expect(users.updateMany).not.toHaveBeenCalled();
  });
  it('rejects weak replacement passwords before database access', async () => {
    const users = {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    };

    const service = new AuthService(
      { user: users } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.resetPassword('a'.repeat(64), '123456'),
    ).rejects.toThrow('Şifre 12 ile 128 karakter arasında olmalıdır');

    expect(users.findFirst).not.toHaveBeenCalled();
    expect(users.updateMany).not.toHaveBeenCalled();
  });
  it('atomically consumes the token and increments sessionVersion', async () => {
    const crypto = await import('crypto');
    const bcrypt = await import('bcrypt');

    const token = 'a'.repeat(64);
    const tokenHash = crypto.createHash('sha256')
      .update(token).digest('hex');
    const newPassword = 'New-Secure-Password-2026';

    const users = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'u1',
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() + 600000),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    const service = new AuthService(
      { user: users } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.resetPassword(token, newPassword);

    expect(users.updateMany).toHaveBeenCalledTimes(1);

    const update = users.updateMany.mock.calls[0][0];

    expect(update.where).toEqual({
      id: 'u1',
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { gt: expect.any(Date) },
    });

    expect(update.data).toEqual({
      password: expect.any(String),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      sessionVersion: { increment: 1 },
    });

    expect(await bcrypt.compare(newPassword, update.data.password))
      .toBe(true);

    expect(result).toEqual({
      message: 'Şifreniz başarıyla sıfırlandı',
    });
  });
  it('does not expose tokens or passwords in reset response', async () => {
    const crypto = await import('crypto');
    const bcrypt = await import('bcrypt');

    const token = 'b'.repeat(64);
    const tokenHash = crypto.createHash('sha256')
      .update(token).digest('hex');
    const newPassword = 'New-Secure-Password-2026';

    const users = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'u1',
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() + 600000),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    const service = new AuthService(
      { user: users } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.resetPassword(token, newPassword);

    expect(result).toEqual({
      message: 'Şifreniz başarıyla sıfırlandı',
    });

    const response = JSON.stringify(result);
    const savedPasswordHash =
      users.updateMany.mock.calls[0][0].data.password;

    expect(await bcrypt.compare(newPassword, savedPasswordHash)).toBe(true);
    expect(response).not.toContain(token);
    expect(response).not.toContain(tokenHash);
    expect(response).not.toContain(newPassword);
    expect(response).not.toContain(savedPasswordHash);
    expect(response).not.toContain('password');
  });
  it('does not undo password reset when security notifications fail', async () => {
    const crypto = await import('crypto');
    const token = 'c'.repeat(64);
    const tokenHash = crypto.createHash('sha256')
      .update(token).digest('hex');

    const users = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'owner@example.com',
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() + 600000),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    const notifications = {
      createNotification: jest.fn()
        .mockRejectedValue(new Error('notification unavailable')),
    };
    const mail = {
      sendMail: jest.fn()
        .mockRejectedValue(new Error('SMTP unavailable')),
    };

    const service = new AuthService(
      { user: users } as any,
      {} as any,
      notifications as any,
      {} as any,
      mail as any,
      {} as any,
    );

    const consoleSpy = jest.spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      await expect(
        service.resetPassword(token, 'New-Secure-Password-2026'),
      ).resolves.toEqual({
        message: 'Şifreniz başarıyla sıfırlandı',
      });

      expect(users.updateMany).toHaveBeenCalledTimes(1);
      expect(notifications.createNotification).toHaveBeenCalledTimes(1);
      expect(mail.sendMail).toHaveBeenCalledTimes(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
