import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { UploadModule } from './upload/upload.module';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';

import { AuthModule } from './auth/auth.module';
import { ProductModule } from './product/product.module';
import { RfqModule } from './rfq/rfq.module';
import { QuoteModule } from './quote/quote.module';
import { OrderModule } from './order/order.module';

import { AdminModule } from './admin/admin.module';
import { PayoutModule } from './payout/payout.module';
import { DisputeModule } from './dispute/dispute.module';

import { WalletModule } from './wallet/wallet.module';
import { PaymentsModule } from './payments/payments.module';

import { CategoryModule } from './category/category.module';
import { SellerModule } from './seller/seller.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CompanyModule } from './company/company.module';
import { ShippingModule } from './shipping/shipping.module';
@Module({
  imports: [
    PrismaModule,
    CommonModule,
    UploadModule,

    AuthModule,
    ProductModule,
    CategoryModule,
    SellerModule,

    RfqModule,
    QuoteModule,
    OrderModule,

    PaymentsModule,
    WalletModule,
    PayoutModule,

    AdminModule,
    DisputeModule,
    DashboardModule,
    CompanyModule,
    ShippingModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}