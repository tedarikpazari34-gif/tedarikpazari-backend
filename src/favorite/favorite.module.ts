import { Module } from '@nestjs/common';

import { FavoriteController } from './favorite.controller';
import { FavoriteService } from './favorite.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [FavoriteController],
  providers: [FavoriteService, PrismaService],
  exports: [FavoriteService],
})
export class FavoriteModule {}
