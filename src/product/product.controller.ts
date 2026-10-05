import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiBody, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ProductService } from './product.service';
import { ProductImportService } from './product-import.service';
import { ProductImportRowAction } from '@prisma/client';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface UploadedImageFile {
  filename: string;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

@ApiTags('Product')
@Controller('products')
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly productImportService: ProductImportService,
  ) {}

  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'sellerId', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'minPrice', required: false })
  @ApiQuery({ name: 'maxPrice', required: false })
  @ApiQuery({ name: 'minMoq', required: false })
  @ApiQuery({ name: 'maxMoq', required: false })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'verified', required: false })
  @ApiQuery({ name: 'lang', required: false })
  @Get()
  list(
    @Query('categoryId') categoryId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('q') q?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('minMoq') minMoq?: string,
    @Query('maxMoq') maxMoq?: string,
    @Query('city') city?: string,
    @Query('verified') verified?: string,
    @Query('lang') lang?: string,
  ) {
    return this.productService.list({
      categoryId,
      sellerId,
      q,
      minPrice,
      maxPrice,
      minMoq,
      maxMoq,
      city,
      verified,
      lang,
    });
  }

  @ApiQuery({ name: 'lang', required: false })
  @Get('category/:categoryId')
  listByCategory(
    @Param('categoryId') categoryId: string,
    @Query('lang') lang?: string,
  ) {
    return this.productService.listByCategory(categoryId, lang);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/upload')
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
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImageFile,
  ) {
    if (!file) {
      throw new BadRequestException('Dosya yüklenemedi');
    }

    return {
      message: 'upload başarılı',
      productId: id,
      filename: file.filename,
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  listMine(@Req() req: any) {
    return this.productService.listMine(req.user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('admin/pending')
  listPending(@Req() req: any) {
    return this.productService.listPending(req.user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/report')
  reportProduct(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string; note?: string },
  ) {
    return this.productService.reportProduct(req.user, id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('bulk-import/template')
  async downloadImportTemplate(@Req() req: any, @Res() res: Response) {
    await this.productImportService.assertImportAccess(req.user);
    const buffer = await this.productImportService.createTemplateBuffer();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="nex-tedarik-pazari-urun-sablonu.xlsx"',
    );
    res.send(buffer);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('bulk-import/export')
  async exportProducts(@Req() req: any, @Res() res: Response) {
    const buffer =
      await this.productImportService.createProductExportBuffer(req.user);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="nex-tedarik-pazari-urunler.xlsx"',
    );
    res.send(buffer);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('bulk-import/excel')
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
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
      },
    }),
  )
  uploadProductExcel(
    @Req() req: any,
    @UploadedFile()
    file: {
      originalname?: string;
      mimetype?: string;
      size?: number;
      buffer?: Buffer;
    },
  ) {
    if (!file) {
      throw new BadRequestException('Excel dosyası yüklenemedi');
    }

    return this.productImportService.createExcelJob(req.user, file);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('bulk-import/jobs/:jobId')
  getImportJob(@Req() req: any, @Param('jobId') jobId: string) {
    return this.productImportService.getJob(req.user, jobId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('bulk-import/jobs/:jobId/rows')
  getImportJobRows(
    @Req() req: any,
    @Param('jobId') jobId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
  ) {
    if (
      action &&
      !Object.values(ProductImportRowAction).includes(
        action as ProductImportRowAction,
      )
    ) {
      throw new BadRequestException(
        'Geçersiz satır durumu. NEW, UPDATE, UNCHANGED veya ERROR kullanılmalıdır',
      );
    }

    const parsedAction = action
      ? (action as ProductImportRowAction)
      : undefined;

    return this.productImportService.getJobRows(
      req.user,
      jobId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
      parsedAction,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('bulk-import/jobs/:jobId/errors.xlsx')
  async downloadImportErrors(
    @Req() req: any,
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.productImportService.createErrorExportBuffer(
      req.user,
      jobId,
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="urun-import-hatalari-${jobId}.xlsx"`,
    );
    res.send(buffer);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('bulk-import/jobs/:jobId/confirm')
  confirmImport(@Req() req: any, @Param('jobId') jobId: string) {
    return this.productImportService.confirmJob(req.user, jobId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('bulk-import/jobs/:jobId/process-next')
  processImportBatch(
    @Req() req: any,
    @Param('jobId') jobId: string,
    @Body() body?: { batchSize?: number },
  ) {
    return this.productImportService.processNextBatch(
      req.user,
      jobId,
      body?.batchSize ?? 100,
    );
  }

  @ApiQuery({ name: 'lang', required: false })
  @Get(':id')
  getOne(
    @Param('id') id: string,
    @Query('lang') lang?: string,
  ) {
    return this.productService.getOne(id, lang);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: any, @Body() body: CreateProductDto) {
    return this.productService.create(req.user, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/images')
  addImages(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.productService.addImages(req.user, id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id/images')
  replaceImages(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.productService.replaceImages(req.user, id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.productService.update(req.user, id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id/approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.productService.approve(req.user, id);
  }
}