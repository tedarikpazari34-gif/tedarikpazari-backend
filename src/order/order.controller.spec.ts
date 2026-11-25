import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

describe('OrderController', () => {
  let controller: OrderController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        { provide: OrderService, useValue: {} },
      ],
    })
      .useMocker((token) =>
        typeof token === 'function' ? {} : undefined,
      )
      .compile();

    controller = module.get<OrderController>(OrderController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // 2859-CT-RELEASE-104: Siparis controller JWT korumalari.
  const protectedMethods = [
    'createDirect',
    'list',
    'getOne',
    'cancel',
    'prepare',
    'ship',
    'complete',
  ] as const;

  it('tum HTTP siparis rotalari envanterde bulunur', () => {
    const prototype = OrderController.prototype as any;

    const actualMethods = Object.getOwnPropertyNames(prototype)
      .filter((name) => (
        name !== 'constructor' &&
        Reflect.getMetadata(
          METHOD_METADATA,
          prototype[name],
        ) !== undefined
      ))
      .sort();

    expect(actualMethods).toEqual(
      [...protectedMethods].sort(),
    );
  });

  it.each(protectedMethods)(
    '%s siparis islemi JwtAuthGuard ile korunur',
    (method) => {
      const prototype = OrderController.prototype as any;
      const handler = prototype[method];

      expect(typeof handler).toBe('function');

      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        handler,
      ) ?? [];

      expect(guards).toContain(JwtAuthGuard);
    },
  );

});
