import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { FavoriteService } from './favorite.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Favorites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('favorites')
export class FavoriteController {
  constructor(private readonly favoriteService: FavoriteService) {}

  @Get()
  @ApiOperation({ summary: 'Favori ürünlerimi listele' })
  list(@Req() req: any) {
    return this.favoriteService.list(req.user);
  }

  @Get('ids')
  @ApiOperation({ summary: 'Favori ürün ID listesini getir' })
  ids(@Req() req: any) {
    return this.favoriteService.ids(req.user);
  }

  @Post(':productId')
  @ApiOperation({ summary: 'Ürünü favorilere ekle' })
  add(@Req() req: any, @Param('productId') productId: string) {
    return this.favoriteService.add(req.user, productId);
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Ürünü favorilerden çıkar' })
  remove(@Req() req: any, @Param('productId') productId: string) {
    return this.favoriteService.remove(req.user, productId);
  }
}
