import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateQuoteDto {
  @IsString()
  rfqId: string;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsInt()
  @Min(1)
  deliveryDays: number;

  @IsOptional()
  @IsString()
  sellerNote?: string;
}
