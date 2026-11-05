import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  UploadApiResponse,
  v2 as cloudinary,
} from 'cloudinary';

export type InvoiceResourceType = 'image' | 'raw';

export interface InvoiceStoredFile {
  publicId: string;
  resourceType: InvoiceResourceType;
  deliveryType: 'authenticated';
}

@Injectable()
export class InvoiceStorageService {
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
    resourceType: InvoiceResourceType,
  ): Promise<InvoiceStoredFile> {
    const result = await new Promise<UploadApiResponse>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'tedarik-pazari-platform/invoices',
            resource_type: resourceType,
            type: 'authenticated',
            overwrite: false,
            use_filename: false,
            unique_filename: true,
          },
          (error, response) => {
            if (error || !response) {
              reject(new InternalServerErrorException(
                'Fatura belgesi yuklenemedi',
              ));
              return;
            }
            resolve(response);
          },
        );
        stream.end(buffer);
      },
    );

    if (typeof result.public_id !== 'string' ||
          !/^tedarik-pazari-platform\/invoices\/[A-Za-z0-9_-]+$/.test(result.public_id) ||
        result.type !== 'authenticated' ||
        result.resource_type !== resourceType) {
      const cleanupResourceType = result.resource_type;

      if (
        typeof result.public_id === 'string' &&
        result.public_id.startsWith(
          'tedarik-pazari-platform/invoices/',
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
    file: InvoiceStoredFile,
    format: string,
  ): { url: string; expiresAt: string } {
    if (
      !file ||
      typeof file.publicId !== 'string' ||
      !/^tedarik-pazari-platform\/invoices\/[A-Za-z0-9_-]+$/.test(file.publicId) ||
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

  async remove(file: InvoiceStoredFile): Promise<void> {
    if (
      !file ||
      typeof file.publicId !== 'string' ||
      !/^tedarik-pazari-platform\/invoices\/[A-Za-z0-9_-]+$/.test(file.publicId) ||
      !['raw', 'image'].includes(file.resourceType) ||
      file.deliveryType !== 'authenticated'
    ) {
      throw new InternalServerErrorException(
        'Gecersiz fatura dosyasi silme referansi',
      );
    }

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
        'Fatura dosya temizligi dogrulanamadi',
      );
    }
  }
}
