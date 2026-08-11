import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'ABC Ltd.' })
  @IsString()
  companyName: string;

  @ApiProperty({ example: 'test@test.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  password: string;

  @ApiProperty({ example: 'BUYER' })
  @IsString()
  role: string;

  @ApiProperty()
  @IsString()
  recaptchaToken: string;

  @ApiProperty({ example: 'Ad Soyad' })
  @IsString()
  @IsNotEmpty({ message: 'Yetkili kişi adı zorunludur' })
  fullName: string;

  @ApiProperty({ example: '+90 555 123 45 67' })
  @IsString()
  @IsNotEmpty({ message: 'Telefon numarası zorunludur' })
  @Matches(/^[+0-9()\s-]{8,20}$/, {
    message: 'Geçerli bir telefon numarası giriniz',
  })
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxOffice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;
}
