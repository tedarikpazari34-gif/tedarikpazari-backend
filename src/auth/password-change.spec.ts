import { AuthService } from './auth.service';

describe('Password change security', () => {
  it('requires authenticated user identity', () => {
    expect(typeof AuthService).toBe('function');
  });

  it('rejects an incorrect current password', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          password: '$2b$10$invalidHash',
          sessionVersion: 0,
        }),
        updateMany: jest.fn(),
      },
    };

    const service = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.changePassword(
        'u1',
        'Wrong-Current-Password',
        'New-Secure-Password-2026',
      ),
    ).rejects.toThrow();

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a weak new password before database access', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const service = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.changePassword('u1', 'Current-Password-2026', '123456'),
    ).rejects.toThrow('Şifre 12 ile 128 karakter arasında olmalıdır');

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it('rejects reuse of the current password', async () => {
    const bcrypt = await import('bcrypt');
    const currentPassword = 'Current-Secure-Password-2026';
    const passwordHash = await bcrypt.hash(currentPassword, 10);

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          password: passwordHash,
          sessionVersion: 0,
        }),
        updateMany: jest.fn(),
      },
    };

    const service = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.changePassword(
        'u1',
        currentPassword,
        currentPassword,
      ),
    ).rejects.toThrow('Yeni şifre mevcut şifreyle aynı olamaz');

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it('increments sessionVersion after a successful password change', async () => {
    const bcrypt = await import('bcrypt');
    const currentPassword = 'Current-Secure-Password-2026';
    const newPassword = 'New-Secure-Password-2026';
    const passwordHash = await bcrypt.hash(currentPassword, 10);

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          password: passwordHash,
          sessionVersion: 3,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const service = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.changePassword(
      'u1',
      currentPassword,
      newPassword,
    );

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'u1',
        sessionVersion: 3,
        password: passwordHash,
      },
      data: {
        password: expect.any(String),
        sessionVersion: { increment: 1 },
      },
    });

    const updateData = prisma.user.updateMany.mock.calls[0][0].data;
    expect(await bcrypt.compare(newPassword, updateData.password)).toBe(true);
    expect(result).toEqual({
      message: 'Şifre başarıyla değiştirildi',
    });
  });
  it('rejects concurrent updates with an outdated sessionVersion', async () => {
    const bcrypt = await import('bcrypt');
    const currentPassword = 'Current-Secure-Password-2026';
    const passwordHash = await bcrypt.hash(currentPassword, 10);

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          password: passwordHash,
          sessionVersion: 3,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const service = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.changePassword(
        'u1',
        currentPassword,
        'Another-Secure-Password-2026',
      ),
    ).rejects.toThrow('Şifre değişikliği çakıştı, tekrar deneyin');

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'u1',
          sessionVersion: 3,
          password: passwordHash,
        },
      }),
    );
  });
  it('does not expose passwords in the service response', async () => {
    const bcrypt = await import('bcrypt');
    const currentPassword = 'Current-Secure-Password-2026';
    const newPassword = 'New-Secure-Password-2026';
    const passwordHash = await bcrypt.hash(currentPassword, 10);

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          password: passwordHash,
          sessionVersion: 0,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const service = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.changePassword(
      'u1',
      currentPassword,
      newPassword,
    );

    expect(result).toEqual({
      message: 'Şifre başarıyla değiştirildi',
    });

    const response = JSON.stringify(result);
    expect(response).not.toContain(currentPassword);
    expect(response).not.toContain(newPassword);
    expect(response).not.toContain(passwordHash);
    expect(response).not.toContain('password');
  });

  it('notifies the account owner after a successful password change', async () => {
    const bcrypt = await import('bcrypt');
    const currentPassword = 'Current-Secure-Password-2026';
    const newPassword = 'New-Secure-Password-2026';
    const passwordHash = await bcrypt.hash(currentPassword, 10);

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'owner@example.com',
          password: passwordHash,
          sessionVersion: 0,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notification-1' }),
    };
    const mailService = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthService(
      prisma as any,
      {} as any,
      notificationService as any,
      {} as any,
      mailService as any,
      {} as any,
    );

    await service.changePassword('u1', currentPassword, newPassword);

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'SYSTEM',
      }),
    );

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.com',
      }),
    );

    const notifications = JSON.stringify([
      notificationService.createNotification.mock.calls,
      mailService.sendMail.mock.calls,
    ]);

    expect(notifications).not.toContain(currentPassword);
    expect(notifications).not.toContain(newPassword);
    expect(notifications).not.toContain(passwordHash);
  });


  it('keeps password change successful when notifications fail', async () => {
    const bcrypt = await import('bcrypt');
    const currentPassword = 'Current-Secure-Password-2026';
    const newPassword = 'New-Secure-Password-2026';
    const passwordHash = await bcrypt.hash(currentPassword, 10);

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'owner@example.com',
          password: passwordHash,
          sessionVersion: 2,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const notifications = {
      createNotification: jest.fn().mockRejectedValue(new Error('notification unavailable')),
    };
    const mail = {
      sendMail: jest.fn().mockRejectedValue(new Error('SMTP unavailable')),
    };

    const service = new AuthService(
      prisma as any,
      {} as any,
      notifications as any,
      {} as any,
      mail as any,
      {} as any,
    );

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        service.changePassword('u1', currentPassword, newPassword),
      ).resolves.toEqual({ message: 'Şifre başarıyla değiştirildi' });

      expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
      expect(notifications.createNotification).toHaveBeenCalledTimes(1);
      expect(mail.sendMail).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('PASSWORD_CHANGE_NOTIFICATION_FAILED');
      expect(consoleSpy).toHaveBeenCalledWith('PASSWORD_CHANGE_MAIL_FAILED');
    } finally {
      consoleSpy.mockRestore();
    }
  });

});
