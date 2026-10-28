import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  UploadApiResponse,
  v2 as cloudinary,
} from 'cloudinary';

export type ChargebackResourceType = 'image' | 'raw';

export interface ChargebackStoredFile {
  publicId: string;
  resourceType: ChargebackResourceType;
  deliveryType: 'authenticated';
}

@Injectable()
export class ChargebackStorageService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  async upload(
    buffer: Buffer,
    resourceType: ChargebackResourceType,
  ): Promise<ChargebackStoredFile> {
    const result = await new Promise<UploadApiResponse>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'tedarik-pazari-platform/chargeback-evidence',
            resource_type: resourceType,
            type: 'authenticated',
            overwrite: false,
            use_filename: false,
            unique_filename: true,
          },
          (error, response) => {
            if (error || !response) {
              reject(new InternalServerErrorException(
                'Chargeback belgesi yuklenemedi',
              ));
              return;
            }
            resolve(response);
          },
        );
        stream.end(buffer);
      },
    );

    if (!result.public_id ||
        result.type !== 'authenticated' ||
        result.resource_type !== resourceType) {
      const cleanupResourceType = result.resource_type;

      if (
        typeof result.public_id === 'string' &&
        result.public_id.startsWith(
          'tedarik-pazari-platform/chargeback-evidence/',
        ) &&
        (cleanupResourceType === 'image' ||
          cleanupResourceType === 'raw') &&
        result.type === 'authenticated'
      ) {
        try {
          await this.remove({
            publicId: result.public_id,
            resourceType: cleanupResourceType,
            deliveryType: 'authenticated',
          });
        } catch {
          throw new InternalServerErrorException(
            'Cloudinary dogrulamasi ve dosya temizligi basarisiz; manuel inceleme gerekli',
          );
        }
      }

      throw new InternalServerErrorException(
        'Cloudinary ozel erisim dogrulanamadi; manuel inceleme gerekli',
      );
    }

    return {
      publicId: result.public_id,
      resourceType,
      deliveryType: 'authenticated',
    };
  }


  createDownloadUrl(
    file: ChargebackStoredFile,
    format: string,
  ): { url: string; expiresAt: string } {
    if (
      !file.publicId ||
      !['image', 'raw'].includes(file.resourceType) ||
      file.deliveryType !== 'authenticated' ||
      !['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(format)
    ) {
      throw new InternalServerErrorException(
        'Gecersiz ozel belge referansi',
      );
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 300;

    const url = cloudinary.utils.private_download_url(
      file.publicId,
      format,
      {
        resource_type: file.resourceType,
        type: 'authenticated',
        expires_at: expiresAt,
        attachment: true,
      },
    );

    if (!url || !url.startsWith('https://')) {
      throw new InternalServerErrorException(
        'Guvenli belge baglantisi olusturulamadi',
      );
    }

    return {
      url,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  async remove(file: ChargebackStoredFile): Promise<void> {
    const result = await cloudinary.uploader.destroy(
      file.publicId,
      {
        resource_type: file.resourceType,
        type: 'authenticated',
        invalidate: true,
      },
    );

    if (result?.result !== 'ok' && result?.result !== 'not found') {
      throw new InternalServerErrorException(
        'Chargeback dosya temizligi dogrulanamadi',
      );
    }
  }
}
