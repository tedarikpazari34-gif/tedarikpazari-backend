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
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

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
  @UseGuards(JwtAuthGuard)
@Post(':id/upload')
@UseInterceptors(FileInterceptor('file'))
uploadImage(
  @Param('id') id: string,
  @UploadedFile() file: Express.Multer.File,
) {
  return {
    message: 'upload başarılı',
    filename: file.filename,
  };
}
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  listMine(@Req() req: any) {
    return this.productService.listMine(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/pending')
  listPending(@Req() req: any) {
    return this.productService.listPending(req.user);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.productService.getOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: any, @Body() body: CreateProductDto) {
    return this.productService.create(req.user, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/images')
  addImages(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.productService.addImages(req.user, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.productService.update(req.user, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.productService.approve(req.user, id);
  }
}
