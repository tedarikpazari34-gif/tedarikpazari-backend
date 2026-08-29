import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  ForbiddenException,
  Body,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../common/guards/admin.guard';
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  private checkAdmin(req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Sadece ADMIN işlem yapabilir');
    }
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('companies')
  @ApiOperation({ summary: 'List companies (ADMIN)' })
  listCompanies(@Req() req: any) {
    this.checkAdmin(req);
    return this.adminService.listCompanies();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('companies/:id/approve')
  @ApiOperation({ summary: 'Approve company (ADMIN)' })
  approveCompany(@Req() req: any, @Param('id') companyId: string) {
    this.checkAdmin(req);
    return this.adminService.approveCompany(companyId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('companies/:id/block')
  @ApiOperation({ summary: 'Block company (ADMIN)' })
  blockCompany(@Req() req: any, @Param('id') companyId: string) {
    this.checkAdmin(req);
    return this.adminService.blockCompany(companyId);
  }


  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('companies/:id/verify')
  @ApiOperation({ summary: 'Verify company (ADMIN)' })
  verifyCompany(@Req() req: any, @Param('id') companyId: string) {
    this.checkAdmin(req);
    return this.adminService.verifyCompany(companyId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('companies/:id/unverify')
  @ApiOperation({ summary: 'Remove company verification (ADMIN)' })
  unverifyCompany(@Req() req: any, @Param('id') companyId: string) {
    this.checkAdmin(req);
    return this.adminService.unverifyCompany(companyId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('verification-requests')
  @ApiOperation({
    summary: 'List company verification requests (ADMIN)',
  })
  listVerificationRequests(@Req() req: any) {
    this.checkAdmin(req);
    return this.adminService.listVerificationRequests();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('verification-requests/:id/approve')
  @ApiOperation({
    summary: 'Approve company verification request (ADMIN)',
  })
  approveVerificationRequest(
    @Req() req: any,
    @Param('id') requestId: string,
    @Body() body: { adminNote?: string },
  ) {
    this.checkAdmin(req);
    return this.adminService.approveVerificationRequest(
      requestId,
      body?.adminNote,
    );
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('verification-requests/:id/reject')
  @ApiOperation({
    summary: 'Reject company verification request (ADMIN)',
  })
  rejectVerificationRequest(
    @Req() req: any,
    @Param('id') requestId: string,
    @Body() body: { adminNote?: string },
  ) {
    this.checkAdmin(req);
    return this.adminService.rejectVerificationRequest(
      requestId,
      body?.adminNote,
    );
  }


  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('products')
  @ApiOperation({ summary: 'List all products (ADMIN)' })
  listAllProducts(@Req() req: any) {
    this.checkAdmin(req);
    return this.adminService.listAllProducts();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('products/:id/deactivate')
  @ApiOperation({ summary: 'Deactivate product (ADMIN)' })
  deactivateProduct(@Req() req: any, @Param('id') productId: string) {
    this.checkAdmin(req);
    return this.adminService.deactivateProduct(productId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('products/pending')
  @ApiOperation({ summary: 'List pending products (ADMIN)' })
  listPendingProducts(@Req() req: any) {
    this.checkAdmin(req);
    return this.adminService.listPendingProducts();
  }

  @UseGuards(JwtAuthGuard)
  @Post('products/:id/approve')
  @ApiOperation({ summary: 'Approve product (ADMIN)' })
  approveProduct(@Req() req: any, @Param('id') productId: string) {
    this.checkAdmin(req);
    return this.adminService.approveProduct(productId);
  }
}