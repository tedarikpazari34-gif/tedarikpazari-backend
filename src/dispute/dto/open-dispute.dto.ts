import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DISPUTE_REASON_CATEGORIES } from '../dispute-reason-category';

export class OpenDisputeDto {
  @IsOptional()
  @IsIn(DISPUTE_REASON_CATEGORIES)
  reasonCategory?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}
