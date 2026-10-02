import { IsString, MaxLength, MinLength } from 'class-validator';

export class RespondDisputeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  sellerNote: string;
}
