import { RfqController } from './rfq.controller';

describe('RFQ controller log gizliliği', () => {
  it('kullanıcının özel bilgilerini loglamaz', () => {
    const service = {
      create: jest.fn(),
      listMine: jest.fn(),
      listOpen: jest.fn(),
      listForSeller: jest.fn(),
    };
    const controller = new RfqController(service as any);
    const log = jest.spyOn((controller as any).logger, 'log')
      .mockImplementation(() => undefined);

    const buyer = {
      user: {
        id: 'user-1',
        role: 'BUYER',
        email: 'private@example.com',
      },
    };
    const seller = {
      user: {
        id: 'user-2',
        role: 'SELLER',
        email: 'seller-private@example.com',
      },
    };

    controller.create(buyer, {});
    controller.listMine(buyer);
    controller.listOpen(seller);
    controller.listForSeller(seller);

    expect(log).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private@example.com');
    expect(JSON.stringify(log.mock.calls)).not.toContain('seller-private@example.com');
  });
});
