import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiBody, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ProductService } from './product.service';
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
  constructor(private readonly productService: ProductService) {}

  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'sellerId', required: false })
  @ApiQuery({ name: 'q', required: false })
  @Get()
  list(
    @Query('categoryId') categoryId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('q') q?: string,
  ) {
    return this.productService.list({ categoryId, sellerId, q });
  }

  @Get('category/:categoryId')
  listByCategory(@Param('categoryId') categoryId: string) {
    return this.productService.listByCategory(categoryId);
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

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.productService.getOne(id);
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