import {
  IsISO8601,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateChargebackDeadlineDto {
  @IsISO8601({ strict: true })
  responseDueAt: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  note: string;
}
