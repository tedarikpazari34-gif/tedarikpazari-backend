import { BadRequestException } from '@nestjs/common';

export function validateNewPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new BadRequestException('Şifre 12 ile 128 karakter arasında olmalıdır');
  }

  if (password.trim() !== password || /[\x00-\x1f\x7f]/.test(password)) {
    throw new BadRequestException('Şifre geçersiz karakter içeriyor');
  }

  return password;
}
