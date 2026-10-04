import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { ReviewsService, ReviewDto } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private auth: AuthService, private reviews: ReviewsService) {}

  @Post()
  async review(@Req() req: Request, @Body() dto: ReviewDto) {
    return this.reviews.review(await this.auth.userFromHeader(req.headers['x-user-id'] as string), dto);
  }
}
