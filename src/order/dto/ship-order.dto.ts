import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ShipOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  shippingCompany: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  shippingTrackingNo: string;
}
