import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  UploadApiOptions,
  UploadApiResponse,
  v2 as cloudinary,
} from 'cloudinary';

@Injectable()
export class CloudinaryService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  async deleteDisputeEvidence(
    publicId: string,
    resourceType: 'image' | 'raw',
  ): Promise<void> {
    if (
      typeof publicId !== 'string' ||
      !publicId.startsWith('tedarik-pazari-platform/disputes/') ||
      publicId.length <= 'tedarik-pazari-platform/disputes/'.length ||
      !['image', 'raw'].includes(resourceType)
    ) {
      throw new Error('Geçersiz uyuşmazlık dosyası kimliği');
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      invalidate: true,
    });

    if (result.result !== 'ok' && result.result !== 'not found') {
      throw new InternalServerErrorException(
        'Uyuşmazlık dosyası Cloudinary üzerinden silinemedi',
      );
    }
  }

  createDisputeEvidenceDownloadUrl(
    publicId: string,
    resourceType: 'image' | 'raw',
    format: string,
  ): { url: string; expiresAt: string } {
    if (
      typeof publicId !== 'string' ||
      !publicId.startsWith('tedarik-pazari-platform/disputes/') ||
      publicId.length <= 'tedarik-pazari-platform/disputes/'.length ||
      !['image', 'raw'].includes(resourceType) ||
      !['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(format)
    ) {
      throw new Error('Geçersiz özel kanıt dosyası referansı');
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 300;

    const url = cloudinary.utils.private_download_url(
      publicId,
      format,
      {
        resource_type: resourceType,
        type: 'authenticated',
        expires_at: expiresAt,
        attachment: true,
      },
    );

    if (!url || !url.startsWith('https://')) {
      throw new Error('Güvenli kanıt indirme bağlantısı oluşturulamadı');
    }

    return {
      url,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  uploadBuffer(
    buffer: Buffer,
    options: UploadApiOptions = {},
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        options,
        (error, result) => {
          if (error || !result) {
            reject(
              new InternalServerErrorException(
                error?.message ||
                  'Cloudinary yükleme işlemi başarısız oldu',
              ),
            );
            return;
          }

          resolve(result);
        },
      );

      uploadStream.end(buffer);
    });
  }
}
