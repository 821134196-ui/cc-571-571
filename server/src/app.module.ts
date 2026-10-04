import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { AuthGuard, RolesGuard } from './auth/auth.guard';
import { AuthController, UsersController } from './auth/auth.controller';
import { LedgerService } from './ledger/ledger.service';
import { ClosingsService } from './closings/closings.service';
import { ClosingsController } from './closings/closings.controller';
import { DiscrepanciesService } from './discrepancies/discrepancies.service';
import { DiscrepanciesController, HandoversController } from './discrepancies/discrepancies.controller';
import { DaysService } from './days/days.service';
import { FinanceService } from './finance/finance.service';
import { MockService } from './finance/mock.service';
import {
  DaysController,
  FinanceController,
  LedgerController,
  MockController,
} from './app.controllers';

@Module({
  controllers: [
    AuthController,
    UsersController,
    ClosingsController,
    DiscrepanciesController,
    HandoversController,
    DaysController,
    FinanceController,
    MockController,
    LedgerController,
  ],
  providers: [
    PrismaService,
    LedgerService,
    ClosingsService,
    DiscrepanciesService,
    DaysService,
    FinanceService,
    MockService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
