import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

const storage = memoryStorage();

const imageFileFilter = (_req: any, file: any, cb: any) => {
  const allowedExt = /\.(jpg|jpeg|png|webp)$/i;
  const ext = extname(file.originalname).toLowerCase();

  const validExt = allowedExt.test(ext);
  const validMime = [
    'image/jpeg',
    'image/png',
    'image/webp',
  ].includes(file.mimetype);

  if (validExt && validMime) {
    cb(null, true);
    return;
  }

  cb(
    new BadRequestException(
      'Sadece jpg, jpeg, png ve webp yüklenebilir',
    ),
    false,
  );
};

const disputeFileFilter = (_req: any, file: any, cb: any) => {
  const allowedExt = /\.(jpg|jpeg|png|webp|pdf)$/i;
  const ext = extname(file.originalname).toLowerCase();

  const validExt = allowedExt.test(ext);
  const validMime = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ].includes(file.mimetype);

  if (validExt && validMime) {
    cb(null, true);
    return;
  }

  cb(
    new BadRequestException(
      'Sadece jpg, jpeg, png, webp ve pdf yüklenebilir',
    ),
    false,
  );
};

@ApiTags('Upload')
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      fileFilter: imageFileFilter,
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Dosya yüklenemedi');
    }

    const result = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      {
        folder: 'tedarik-pazari-platform/products',
        resource_type: 'image',
      },
    );

    return {
      message: 'Dosya yüklendi',
      imageUrl: result.secure_url,
    };
  }

  @Post('verification')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      fileFilter: disputeFileFilter,
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async uploadVerificationDocument(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Doğrulama belgesi yüklenemedi',
      );
    }

    const result = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      {
        folder:
          'tedarik-pazari-platform/verification-documents',
        resource_type: 'auto',
      },
    );

    return {
      message: 'Doğrulama belgesi yüklendi',
      documentUrl: result.secure_url,
      publicId: result.public_id,
      originalName: file.originalname,
      mimeType: file.mimetype,
    };
  }

  @Post('dispute')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      fileFilter: disputeFileFilter,
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async uploadDisputeFile(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Dosya yüklenemedi');
    }

    const result = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      {
        folder: 'tedarik-pazari-platform/disputes',
        resource_type: 'auto',
      },
    );

    return {
      message: 'Uyuşmazlık dosyası yüklendi',
      fileUrl: result.secure_url,
      fileName: file.originalname,
      fileType: file.mimetype,
    };
  }

  @Post('multiple')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
      required: ['files'],
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage,
      fileFilter: imageFileFilter,
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async uploadMultiple(
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Dosyalar yüklenemedi');
    }

    const uploadedFiles = await Promise.all(
      files.map((file) =>
        this.cloudinaryService.uploadBuffer(file.buffer, {
          folder: 'tedarik-pazari-platform/products',
          resource_type: 'image',
        }),
      ),
    );

    return {
      message: 'Dosyalar yüklendi',
      images: uploadedFiles.map((result, index) => ({
        url: result.secure_url,
        sortOrder: index,
        isCover: index === 0,
      })),
    };
  }
}
