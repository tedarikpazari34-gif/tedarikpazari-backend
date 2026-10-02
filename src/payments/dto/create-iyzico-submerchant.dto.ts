import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIyzicoSubMerchantDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  iban?: string;

  @IsOptional()
  @IsString()
  @MaxLength(11)
  identityNumber?: string;
}
