import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import {
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';

const storage = diskStorage({
  destination: './uploads',
  filename: (_req, file, cb) => {
    const uniqueName =
      Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueName}${extname(file.originalname)}`);
  },
});

const imageFileFilter = (_req: any, file: any, cb: any) => {
  const allowedExt = /jpg|jpeg|png|webp/;
  const ext = extname(file.originalname).toLowerCase();

  const validExt = allowedExt.test(ext);
  const validMime =
    file.mimetype === 'image/jpeg' ||
    file.mimetype === 'image/png' ||
    file.mimetype === 'image/webp';

  if (validExt && validMime) {
    cb(null, true);
  } else {
    cb(
      new BadRequestException('Sadece jpg, jpeg, png, webp yüklenebilir'),
      false,
    );
  }
};

@ApiTags('Upload')
@Controller('upload')
export class UploadController {
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
  uploadFile(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Dosya yüklenemedi');
    }

    return {
      message: 'Dosya yüklendi',
      imageUrl: `/uploads/${file.filename}`,
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
  uploadMultiple(@UploadedFiles() files: any[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Dosyalar yüklenemedi');
    }

    return {
      message: 'Dosyalar yüklendi',
      images: files.map((file, index) => ({
        url: `/uploads/${file.filename}`,
        sortOrder: index,
        isCover: index === 0,
      })),
    };
  }
}