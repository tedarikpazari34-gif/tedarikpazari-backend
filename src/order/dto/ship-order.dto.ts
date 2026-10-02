import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class ShipOrderDto {
  @IsString()
  @IsIn(['CARGO', 'FREIGHT'])
  shippingMethod: 'CARGO' | 'FREIGHT';

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  shippingCompany: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(150)
  shippingTrackingNo: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  shippingDispatchNo?: string;
}
