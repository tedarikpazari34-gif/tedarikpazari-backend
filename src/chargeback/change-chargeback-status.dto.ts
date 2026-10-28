import { ChargebackStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsISO8601, MaxLength, MinLength } from 'class-validator';

export class ChangeChargebackStatusDto {
  @IsEnum(ChargebackStatus)
  expectedStatus: ChargebackStatus;

  @IsEnum(ChargebackStatus)
  nextStatus: ChargebackStatus;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(150)
  bankDecisionReference?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(150)
  iyzicoSubmissionReference?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  iyzicoSubmissionAt?: string;
}
