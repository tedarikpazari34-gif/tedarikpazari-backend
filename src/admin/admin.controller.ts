import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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

  @UseGuards(JwtAuthGuard)
  @Get('companies')
  @ApiOperation({ summary: 'List companies (ADMIN)' })
  listCompanies(@Req() req: any) {
    this.checkAdmin(req);
    return this.adminService.listCompanies();
  }

  @UseGuards(JwtAuthGuard)
  @Post('companies/:id/approve')
  @ApiOperation({ summary: 'Approve company (ADMIN)' })
  approveCompany(@Req() req: any, @Param('id') companyId: string) {
    this.checkAdmin(req);
    return this.adminService.approveCompany(companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('companies/:id/block')
  @ApiOperation({ summary: 'Block company (ADMIN)' })
  blockCompany(@Req() req: any, @Param('id') companyId: string) {
    this.checkAdmin(req);
    return this.adminService.blockCompany(companyId);
  }

  @UseGuards(JwtAuthGuard)
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