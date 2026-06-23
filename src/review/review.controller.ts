import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReviewService } from './review.service';

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Req() req: any,
    @Body()
    body: {
      orderId: string;
      rating: number;
      comment?: string;
    },
  ) {
    return this.reviewService.create(req.user, body);
  }

  @Get('seller/:sellerId')
  getSellerReviews(@Param('sellerId') sellerId: string) {
    return this.reviewService.getSellerReviews(sellerId);
  }
}