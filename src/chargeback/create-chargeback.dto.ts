import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateChargebackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  orderId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  providerReference: string;

  @IsString()
  @Matches(/^(?:0\.(?!00$)\d{1,2}|[1-9]\d*(?:\.\d{1,2})?)$/)
  disputedAmount: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;

  @IsISO8601({ strict: true })
  notifiedAt: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  responseDueAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
