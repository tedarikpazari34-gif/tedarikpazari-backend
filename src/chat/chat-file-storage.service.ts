import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  validateChatFile,
  ValidatedChatFile,
} from './chat-file-policy';

export type StoredChatFile = ValidatedChatFile & {
  publicId: string;
};

const CHAT_FOLDER = 'tedarik-pazari-platform/chat';

export function isValidChatStorageReference(
  publicId: unknown,
): publicId is string {
  return (
    typeof publicId === 'string' &&
    /^tedarik-pazari-platform\/chat\/[A-Za-z0-9_-]+(?:\.pdf)?$/.test(
      publicId,
    )
  );
}

@Injectable()
export class ChatFileStorageService {
  constructor(
    private readonly cloudinary: CloudinaryService,
  ) {}

  async remove(stored: StoredChatFile): Promise<void> {
    if (
      !stored ||
      !isValidChatStorageReference(stored.publicId) ||
      !['image', 'raw'].includes(stored.resourceType)
    ) {
      throw new InternalServerErrorException(
        'Gecersiz sohbet dosyasi temizleme referansi',
      );
    }

    await this.cloudinary.deleteChatUpload(
      stored.publicId,
      stored.resourceType,
      'authenticated',
    );
  }

  async upload(
    file: Pick<
      Express.Multer.File,
      'buffer' | 'size' | 'mimetype'
    >,
  ): Promise<StoredChatFile> {
    const validated = validateChatFile(file);

    const result = await this.cloudinary.uploadBuffer(
      file.buffer,
      {
        folder: CHAT_FOLDER,
        resource_type: validated.resourceType,
        type: 'authenticated',
        overwrite: false,
        use_filename: false,
        unique_filename: true,
      },
    );

    if (
      !result ||
      result.type !== 'authenticated' ||
      result.resource_type !== validated.resourceType ||
      !isValidChatStorageReference(result.public_id)
    ) {
      if (
        result &&
        isValidChatStorageReference(result.public_id) &&
        (result.resource_type === 'image' ||
          result.resource_type === 'raw') &&
        (result.type === 'authenticated' ||
          result.type === 'upload')
      ) {
        try {
          await this.cloudinary.deleteChatUpload(
            result.public_id,
            result.resource_type,
            result.type,
          );
        } catch {
          throw new InternalServerErrorException(
            'Sohbet dosyasi temizlenemedi; manuel inceleme gerekli',
          );
        }
      }

      throw new InternalServerErrorException(
        'Sohbet dosyasinin ozel depolama dogrulamasi basarisiz; manuel inceleme gerekli',
      );
    }

    return {
      ...validated,
      publicId: result.public_id,
    };
  }
}
