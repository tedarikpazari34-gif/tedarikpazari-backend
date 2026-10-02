import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class OpenDisputeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}
