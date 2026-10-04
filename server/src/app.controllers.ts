import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { DaysService } from './days/days.service';
import { FinanceService } from './finance/finance.service';
import { MockService } from './finance/mock.service';
import { LedgerService } from './ledger/ledger.service';
import { CurrentUser, RolesAllowed } from './auth/auth.guard';
import { Roles } from './domain/constants';

@Controller('business-days')
export class DaysController {
  constructor(private days: DaysService) {}

  @Get('current')
  current() {
    return this.days.current();
  }

  @Get()
  list() {
    return this.days.list();
  }

  @Post(':id/close')
  @RolesAllowed(Roles.FINANCE)
  close(@CurrentUser() user: User, @Param('id') id: string) {
    return this.days.close(user, id);
  }

  @Post('open-next')
  @RolesAllowed(Roles.FINANCE)
  openNext(@CurrentUser() user: User) {
    return this.days.openNext(user);
  }
}

class ReceiptDto {
  @IsString()
  @IsNotEmpty()
  receiptNo: string;

  @IsString()
  @IsNotEmpty()
  discrepancyId: string;

  @IsInt()
  @Min(1)
  amountCents: number;
}

@Controller('finance')
export class FinanceController {
  constructor(private finance: FinanceService) {}

  /** 财务回执入账（幂等：重复回执不再次冲销） */
  @Post('receipts')
  @RolesAllowed(Roles.FINANCE)
  applyReceipt(@CurrentUser() user: User, @Body() dto: ReceiptDto) {
    return this.finance.applyReceipt(user, dto);
  }

  @Get('receipts')
  @RolesAllowed(Roles.FINANCE)
  receipts() {
    return this.finance.receipts();
  }
}

class MachineCountDto {
  @IsString()
  @IsNotEmpty()
  closingId: string;

  @IsOptional()
  counts?: { denomCents: number; qty: number }[];
}

class MockReceiptDto {
  @IsOptional()
  @IsString()
  receiptNo?: string;

  @IsString()
  @IsNotEmpty()
  discrepancyId: string;

  @IsInt()
  @Min(1)
  amountCents: number;
}

@Controller('mock')
export class MockController {
  constructor(private mock: MockService) {}

  /** 模拟点钞机清点 */
  @Post('machine-count')
  machineCount(@CurrentUser() user: User, @Body() dto: MachineCountDto) {
    return this.mock.machineCount(user, dto);
  }

  /** 模拟财务系统回执回调 */
  @Post('finance/send-receipt')
  sendReceipt(@CurrentUser() user: User, @Body() dto: MockReceiptDto) {
    return this.mock.sendReceipt(user, dto);
  }
}

@Controller('ledger')
export class LedgerController {
  constructor(private ledger: LedgerService) {}

  /** 对账：台账余额与未了长短款核对 */
  @Get('reconcile')
  reconcile() {
    return this.ledger.reconcile();
  }
}
