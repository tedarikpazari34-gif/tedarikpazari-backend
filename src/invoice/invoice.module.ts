import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { InvoiceNotifier } from './invoice-notifier.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { SellerInvoiceUploadService } from './invoice-upload.service';
import { ReturnInvoiceUploadService } from './invoice-return-upload.service';
import { AdminInvoiceReviewService } from './invoice-review.service';
import { InvoiceStorageService } from './invoice-storage.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceStorageService, SellerInvoiceUploadService, ReturnInvoiceUploadService, AdminInvoiceReviewService, InvoiceNotifier],
})
export class InvoiceModule {}
