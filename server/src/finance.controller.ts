import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { FinanceService, SubmitReceiptDto } from './finance.service';

@Controller('finance')
export class FinanceController {
  constructor(private auth: AuthService, private finance: FinanceService) {}

  @Get('pending')
  async pending() {
    return this.finance.listPending();
  }

  @Get('receipts')
  async receipts() {
    return this.finance.listReceipts();
  }

  /** 财务确认：本地模拟财务系统签发确认回执并幂等处理 */
  @Post('confirm')
  async confirm(@Req() req: Request, @Body() body: { dispositionId: string }) {
    const user = await this.auth.userFromHeader(req.headers['x-user-id'] as string);
    return this.finance.issueMockReceipt(user, body.dispositionId, 'CONFIRM');
  }

  /** 财务冲销：本地模拟财务系统签发冲销回执并幂等处理 */
  @Post('reverse')
  async reverse(@Req() req: Request, @Body() body: { dispositionId: string }) {
    const user = await this.auth.userFromHeader(req.headers['x-user-id'] as string);
    return this.finance.issueMockReceipt(user, body.dispositionId, 'REVERSAL');
  }

  /** 财务回执接收接口（幂等）：重复 receiptNo 不会重复处理 */
  @Post('receipts')
  async submitReceipt(@Req() req: Request, @Body() dto: SubmitReceiptDto) {
    return this.finance.submitReceipt(await this.auth.userFromHeader(req.headers['x-user-id'] as string), dto);
  }
}
