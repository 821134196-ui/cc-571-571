import { Module } from '@nestjs/common';
import { AdjustmentsService } from './adjustments.service';
import { AuthService } from './auth.service';
import { BooksService } from './books.service';
import { ClosingsController } from './closings.controller';
import { ClosingsService } from './closings.service';
import { DaysController } from './days.controller';
import { DaysService } from './days.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
import { MockController } from './mock.controller';
import { PrismaService } from './prisma.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [
    UsersController,
    DaysController,
    ClosingsController,
    ReviewsController,
    FinanceController,
    MockController,
  ],
  providers: [
    PrismaService,
    AuthService,
    LedgerService,
    BooksService,
    ClosingsService,
    AdjustmentsService,
    ReviewsService,
    FinanceService,
    DaysService,
  ],
})
export class AppModule {}
