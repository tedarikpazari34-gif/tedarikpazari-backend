import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SavePushTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsOptional()
  platform?: string;

  @IsString()
  @IsOptional()
  userAgent?: string;
}
