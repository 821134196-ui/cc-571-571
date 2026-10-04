import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AdjustmentsService, CreateAdjustmentDto } from './adjustments.service';
import { AuthService } from './auth.service';
import { ClosingsService, CreateClosingDto } from './closings.service';

@Controller('closings')
export class ClosingsController {
  constructor(
    private auth: AuthService,
    private closings: ClosingsService,
    private adjustments: AdjustmentsService,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateClosingDto) {
    return this.closings.create(await this.auth.userFromHeader(req.headers['x-user-id'] as string), dto);
  }

  @Get('mine')
  async mine(@Req() req: Request) {
    return this.closings.listMine(await this.auth.userFromHeader(req.headers['x-user-id'] as string));
  }

  @Get('pending-review')
  async pendingReview() {
    return this.closings.listPendingReview();
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.closings.detail(id);
  }

  @Post(':id/adjustments')
  async addAdjustment(@Req() req: Request, @Param('id') id: string, @Body() dto: CreateAdjustmentDto) {
    return this.adjustments.add(await this.auth.userFromHeader(req.headers['x-user-id'] as string), id, dto);
  }
}
