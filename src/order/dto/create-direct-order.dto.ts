import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';

export class CreateDirectOrderDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  variantId?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/)
  expectedTotalAmount?: string;
}
