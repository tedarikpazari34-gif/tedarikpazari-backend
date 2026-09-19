import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';

@Injectable()
export class SensitiveDataService {
  private readonly prefix = 'enc:v1:';

  private getKey(): Buffer {
    const encodedKey = process.env.SENSITIVE_DATA_KEY;

    if (!encodedKey) {
      throw new InternalServerErrorException(
        'Sensitive data encryption key is not configured',
      );
    }

    const key = Buffer.from(encodedKey, 'base64');

    if (key.length !== 32) {
      throw new InternalServerErrorException(
        'Sensitive data encryption key must be 32 bytes',
      );
    }

    return key;
  }

  isEncrypted(value?: string | null): boolean {
    return Boolean(value?.startsWith(this.prefix));
  }

  encrypt(value?: string | null): string | null {
    if (!value) {
      return null;
    }

    if (this.isEncrypted(value)) {
      return value;
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);

    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return (
      this.prefix +
      [
        iv.toString('base64'),
        authTag.toString('base64'),
        ciphertext.toString('base64'),
      ].join(':')
    );
  }

  decrypt(value?: string | null): string | null {
    if (!value) {
      return null;
    }

    if (!this.isEncrypted(value)) {
      return value;
    }

    const payload = value.slice(this.prefix.length);
    const parts = payload.split(':');

    if (parts.length !== 3) {
      throw new InternalServerErrorException(
        'Invalid encrypted sensitive data',
      );
    }

    try {
      const [ivBase64, authTagBase64, ciphertextBase64] = parts;

      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.getKey(),
        Buffer.from(ivBase64, 'base64'),
      );

      decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextBase64, 'base64')),
        decipher.final(),
      ]);

      return plaintext.toString('utf8');
    } catch {
      throw new InternalServerErrorException(
        'Sensitive data could not be decrypted',
      );
    }
  }
}
