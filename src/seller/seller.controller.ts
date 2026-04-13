import { Controller, Get, Param } from '@nestjs/common';
import { SellerService } from './seller.service';

@Controller('sellers')
export class SellerController {
  constructor(private readonly sellerService: SellerService) {}

  @Get(':id')
  async getSeller(@Param('id') id: string) {
    return this.sellerService.getSeller(id);
  }
}
