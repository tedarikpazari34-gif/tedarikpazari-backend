import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminController } from './admin.controller';

describe('Admin product revision approval', () => {
  const approveRevision = jest.fn();
  const revisionService = { approveRevision };

  const controller = new AdminController(
    {} as never,
    revisionService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('yönetici revizyon onaylama servisini çağırabilir', async () => {
    const user = { id: 'admin-1', role: Role.ADMIN };
    approveRevision.mockResolvedValue({
      revisionId: 'revision-1',
      status: 'APPROVED',
    });

    await expect(
      controller.approveProductRevision(
        { user },
        'revision-1',
      ),
    ).resolves.toEqual({
      revisionId: 'revision-1',
      status: 'APPROVED',
    });

    expect(approveRevision).toHaveBeenCalledWith(
      user,
      'revision-1',
    );
  });

  it('satıcı revizyon onaylayamaz', () => {
    expect(() =>
      controller.approveProductRevision(
        { user: { id: 'seller-1', role: Role.SELLER } },
        'revision-1',
      ),
    ).toThrow(ForbiddenException);

    expect(approveRevision).not.toHaveBeenCalled();
  });
});
