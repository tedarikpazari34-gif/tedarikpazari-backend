import { IsString, Matches, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword: string;
}
