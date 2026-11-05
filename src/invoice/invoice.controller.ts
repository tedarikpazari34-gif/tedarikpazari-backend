import {
  Body,
  Post,
  UploadedFile,
  UseInterceptors,
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { InvoiceWriteGuard } from './invoice-write.guard';
import { InvoiceService } from './invoice.service';
import { SellerInvoiceUploadService } from './invoice-upload.service';
import { ReturnInvoiceUploadService } from './invoice-return-upload.service';
import { AdminInvoiceReviewService } from './invoice-review.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoiceController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly uploads: SellerInvoiceUploadService,
    private readonly reviews: AdminInvoiceReviewService,
    private readonly returns: ReturnInvoiceUploadService,
  ) {}

  @Post('orders/:orderId')
  @UseGuards(InvoiceWriteGuard)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  }))
  uploadSale(
    @Req() req: any,
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: {
      invoiceNumber?: string;
      channel?: string;
      issuedAt?: string;
    },
  ) {
    return this.uploads.uploadSale(req.user, orderId, file, body);
  }

  @Post('returns/:orderId')
  @UseGuards(InvoiceWriteGuard)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  }))
  uploadReturn(
    @Req() req: any,
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: {
      kind?: string;
      disputeId: string;
      originalSaleInvoiceId?: string;
      invoiceNumber?: string;
      channel?: string;
      issuedAt?: string;
    },
  ) {
    return this.returns.upload(
      req.user, orderId, file, body,
    );
  }

  @Get('mine')
  @ApiOperation({
    summary: 'Buyer and seller own invoice records',
  })
  mine(@Req() req: any) {
    return this.invoices.listMine(req.user);
  }

  @Post('admin/:id/review')
  @UseGuards(AdminGuard, InvoiceWriteGuard)
  @ApiOperation({
    summary: 'Admin review of previously issued invoice documents',
  })
  review(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { action?: string; reason?: string },
  ) {
    return this.reviews.review(req.user, id, body);
  }

  @Get('admin')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin invoice audit records',
  })
  admin(@Req() req: any) {
    return this.invoices.listAdmin(req.user);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Authorized private invoice PDF download',
  })
  download(@Req() req: any, @Param('id') id: string) {
    return this.invoices.download(req.user, id);
  }

  @Get(':id/access')
  @ApiOperation({
    summary: 'Verify authorized invoice document access',
  })
  access(@Req() req: any, @Param('id') id: string) {
    return this.invoices.verifyDownloadAccess(req.user, id);
  }
}
