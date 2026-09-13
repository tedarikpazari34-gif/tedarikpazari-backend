import { Injectable } from '@nestjs/common';
import {
  CreateShipmentInput,
  CreateShipmentResult,
  ShipmentTrackingResult,
  ShippingProvider,
} from './shipping-provider.interface';

@Injectable()
export class ManualShippingProvider implements ShippingProvider {
  readonly name = 'MANUAL';

  async createShipment(
    input: CreateShipmentInput,
  ): Promise<CreateShipmentResult> {
    const trackingNo = `MAN-${Date.now()}`;

    return {
      provider: this.name,
      trackingNo,
      shipmentId: input.orderId,
      trackingUrl: null,
      labelUrl: null,
    };
  }

  async trackShipment(
    trackingNo: string,
  ): Promise<ShipmentTrackingResult> {
    return {
      provider: this.name,
      trackingNo,
      status: 'MANUAL',
      description: 'Gönderi manuel lojistik süreci ile takip ediliyor.',
      updatedAt: new Date(),
    };
  }

  async cancelShipment(
    _trackingNo: string,
  ): Promise<void> {
    return;
  }
}
