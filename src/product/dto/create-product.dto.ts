import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  unitType: string;

  @IsInt()
  @Min(1)
  moq: number;

  @IsNumber()
  @Min(0)
  basePrice: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  stockType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  vatRate?: number;

  @IsOptional()
  @IsBoolean()
  rfqEnabled?: boolean;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}