import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { DaysService } from './days.service';

@Controller('days')
export class DaysController {
  constructor(private auth: AuthService, private days: DaysService) {}

  @Get('current')
  async current() {
    return this.days.current();
  }

  @Get()
  async list() {
    return this.days.list();
  }

  @Get(':id/report')
  async report(@Param('id') id: string) {
    return this.days.report(id);
  }

  @Post('close')
  async close(@Req() req: Request) {
    return this.days.closeCurrent(await this.auth.userFromHeader(req.headers['x-user-id'] as string));
  }

  @Post('open-next')
  async openNext(@Req() req: Request, @Body() body: { date: string }) {
    return this.days.openNext(await this.auth.userFromHeader(req.headers['x-user-id'] as string), body.date);
  }
}
