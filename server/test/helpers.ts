process.env.DATABASE_URL = 'file:./test.db?connection_limit=1';

import { PrismaClient, User } from '@prisma/client';
import { expect } from 'vitest';
import { AdjustmentsService } from '../src/adjustments.service';
import { BooksService, signedAmount } from '../src/books.service';
import { ClosingsService } from '../src/closings.service';
import { DaysService } from '../src/days.service';
import { FinanceService } from '../src/finance.service';
import { LedgerService } from '../src/ledger.service';
import { ReviewsService } from '../src/reviews.service';

export const prisma = new PrismaClient();

export function makeServices() {
  const ledger = new LedgerService(prisma as any);
  const books = new BooksService(prisma as any);
  const closings = new ClosingsService(prisma as any, ledger);
  const adjustments = new AdjustmentsService(prisma as any, ledger, books);
  const reviews = new ReviewsService(prisma as any);
  const finance = new FinanceService(prisma as any, ledger);
  const days = new DaysService(prisma as any, ledger);
  return { ledger, books, closings, adjustments, reviews, finance, days };
}

export interface TestUsers {
  teller1: User;
  teller2: User;
  supervisor: User;
  supervisor2: User;
  finance: User;
}

export async function resetAndSeed(): Promise<TestUsers> {
  await prisma.ledgerEntry.deleteMany();
  await prisma.financeReceipt.deleteMany();
  await prisma.disposition.deleteMany();
  await prisma.adjustment.deleteMany();
  await prisma.review.deleteMany();
  await prisma.denomLine.deleteMany();
  await prisma.cashClosing.deleteMany();
  await prisma.businessDay.deleteMany();
  await prisma.user.deleteMany();

  const [teller1, teller2, supervisor, supervisor2, finance] = await Promise.all([
    prisma.user.create({ data: { username: 'teller1', name: '张敏', role: 'TELLER' } }),
    prisma.user.create({ data: { username: 'teller2', name: '李强', role: 'TELLER' } }),
    prisma.user.create({ data: { username: 'sup1', name: '王芳', role: 'SUPERVISOR' } }),
    prisma.user.create({ data: { username: 'sup2', name: '陈静', role: 'SUPERVISOR' } }),
    prisma.user.create({ data: { username: 'fin', name: '赵磊', role: 'FINANCE' } }),
  ]);
  return { teller1, teller2, supervisor, supervisor2, finance };
}

export async function openDay(date: string) {
  return prisma.businessDay.create({ data: { date } });
}

/** 构造面额明细的便捷方法 */
export function line(denomCents: number, expectedQty: number, manualQty: number, machineQty?: number) {
  return { denomCents, expectedQty, manualQty, machineQty };
}

/**
 * 账目一致性恒等式（调整前后都必须成立）：
 *   Σ账本条目(结柜) == 当前差额 - Σ已确认处置单(有符号)
 * 即“账本净额 == 尚未了结的现金余额”。结清时两侧均为 0。
 * （待处理处置单尚未发生现金收付，不参与本恒等式。）
 */
export async function assertBooksBalanced(closingId: string) {
  const closing = await prisma.cashClosing.findUniqueOrThrow({
    where: { id: closingId },
    include: { dispositions: true },
  });
  const ledger = await prisma.ledgerEntry.aggregate({
    _sum: { amountCents: true },
    where: { closingId },
  });
  const resolved = closing.dispositions
    .filter((d) => d.status === 'CONFIRMED')
    .reduce((s, d) => s + signedAmount(d.kind, d.amountCents), 0);
  const lhs = ledger._sum.amountCents ?? 0;
  const rhs = closing.diffCents - resolved;
  expect(lhs, `结柜单 ${closingId} 账目不平：账本净额 ${lhs} ≠ 未解决余额 ${rhs}`).toBe(rhs);
  return { ledgerSum: lhs, outstanding: rhs };
}

export async function ledgerEntries(closingId: string) {
  return prisma.ledgerEntry.findMany({ where: { closingId }, orderBy: { createdAt: 'asc' } });
}
