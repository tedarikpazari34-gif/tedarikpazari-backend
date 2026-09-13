export type ShipmentAddress = {
  name: string;
  phone?: string | null;
  city: string;
  district?: string | null;
  address: string;
  postalCode?: string | null;
  countryCode?: string | null;
};

export type ShipmentPackage = {
  weight?: number | null;
  volume?: number | null;
  quantity?: number | null;
};

export type CreateShipmentInput = {
  orderId: string;
  sender: ShipmentAddress;
  recipient: ShipmentAddress;
  package: ShipmentPackage;
  referenceNo?: string | null;
};

export type CreateShipmentResult = {
  provider: string;
  trackingNo: string;
  shipmentId?: string | null;
  trackingUrl?: string | null;
  labelUrl?: string | null;
};

export type ShipmentTrackingResult = {
  provider: string;
  trackingNo: string;
  status: string;
  description?: string | null;
  updatedAt?: Date | null;
};

export interface ShippingProvider {
  readonly name: string;

  createShipment(
    input: CreateShipmentInput,
  ): Promise<CreateShipmentResult>;

  trackShipment(
    trackingNo: string,
  ): Promise<ShipmentTrackingResult>;

  cancelShipment(
    trackingNo: string,
  ): Promise<void>;
}
