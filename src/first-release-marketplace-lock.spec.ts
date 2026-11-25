
import { ServiceUnavailableException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module';
import { RfqModule } from './rfq/rfq.module';
import { QuoteModule } from './quote/quote.module';
import { ChatController } from './chat/chat.controller';
import { ShippingController } from './shipping/shipping.controller';

describe('First release marketplace lock', () => {
  it('removes product RFQ and quote modules from AppModule', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS, AppModule,
    ) as unknown[];
    expect(imports).not.toContain(RfqModule);
    expect(imports).not.toContain(QuoteModule);
  });

  it('rejects new RFQ chat threads', () => {
    const service = { createThreadForRfq: jest.fn() };
    const controller = new ChatController(service as any);
    expect(() => controller.createRfqThread(
      { user: { role: 'BUYER' } }, 'fake-rfq',
    )).toThrow(ServiceUnavailableException);
    expect(service.createThreadForRfq).not.toHaveBeenCalled();
  });

  it('preserves order chat creation', async () => {
    const service = {
      createThreadForOrder: jest.fn().mockResolvedValue({ id: 'fake' }),
    };
    const controller = new ChatController(service as any);
    await expect(controller.createOrderThread(
      { user: { role: 'BUYER' } }, 'fake-order',
    )).resolves.toEqual({ id: 'fake' });
  });

  const service = {
    createRFQ: jest.fn(),
    listOpen: jest.fn(),
    sendQuote: jest.fn(),
    listQuotesForBuyer: jest.fn().mockResolvedValue([]),
    acceptQuote: jest.fn(),
    pickup: jest.fn(),
    transit: jest.fn(),
    deliver: jest.fn(),
    listShippingOrders: jest.fn().mockResolvedValue([]),
  };
  const controller = new ShippingController(service as any);
  const req = { user: { role: 'BUYER', companyId: 'fake' } };

  const blocked: [string, () => unknown][] = [
    ['create RFQ', () => controller.create(req, {})],
    ['list open RFQs', () => controller.list(req)],
    ['send quote', () => controller.quote(req, {})],
    ['accept quote', () => controller.accept(req, 'fake')],
    ['pickup', () => controller.pickup(req, 'fake')],
    ['transit', () => controller.transit(req, 'fake')],
    ['deliver', () => controller.deliver(req, 'fake')],
  ];

  it.each(blocked)('%s is blocked even with feature flag true',
    (_label, action) => {
      jest.clearAllMocks();
      expect(action).toThrow(ServiceUnavailableException);
      for (const fn of [
        service.createRFQ, service.listOpen, service.sendQuote,
        service.listQuotesForBuyer, service.acceptQuote,
        service.pickup, service.transit, service.deliver,
      ]) {
        expect(fn).not.toHaveBeenCalled();
      }
    },
  );

  it('preserves authorized historical buyer quote reads', async () => {
    await expect(controller.buyer(req)).resolves.toEqual([]);
    expect(service.listQuotesForBuyer).toHaveBeenCalledTimes(1);
  });

  it('keeps historical shipping orders readable', async () => {
    await expect(controller.orders(req)).resolves.toEqual([]);
    expect(service.listShippingOrders).toHaveBeenCalled();
  });
});
