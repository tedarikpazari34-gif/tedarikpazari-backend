import { IsBoolean, IsEnum, IsOptional, IsString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DisputeResolution } from '@prisma/client';

export class ResolveDisputeDto {
  @IsBoolean()
  physicalReturnConfirmed?: boolean;

  @IsEnum(DisputeResolution)
  resolution: DisputeResolution;

  @IsOptional()
  @IsString()
  adminNote?: string;

  // Sadece PARTIAL_REFUND için zorunlu olacak (serviste kontrol ediliyor)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  partialRefundAmount?: number;
}