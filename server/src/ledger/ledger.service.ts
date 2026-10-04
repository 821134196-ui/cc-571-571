import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { Accounts, DiscrepancyStatus, DiffType } from '../domain/constants';

export interface LedgerPosting {
  account: string;
  amountCents: number;
  memo?: string;
}

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  /**
   * 写入一批台账分录。同一批必须配平（合计为 0），否则拒绝 ——
   * 这是「调整前后账目一致」的第一道防线；所有分录与业务写入同事务提交。
   */
  async post(
    tx: Prisma.TransactionClient,
    businessDayId: string,
    refType: string,
    refId: string,
    postings: LedgerPosting[],
  ) {
    const sum = postings.reduce((acc, p) => acc + p.amountCents, 0);
    if (sum !== 0) {
      throw new BadRequestException(`台账分录未配平（合计 ${sum} 分），已拒绝入账`);
    }
    for (const p of postings) {
      if (p.amountCents === 0) continue;
      await tx.ledgerEntry.create({
        data: {
          businessDayId,
          account: p.account,
          amountCents: p.amountCents,
          refType,
          refId,
          memo: p.memo,
        },
      });
    }
  }

  /** 对账：台账余额 vs 未了长短款，必须处处相等 */
  async reconcile() {
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['account'],
      _sum: { amountCents: true },
    });
    const accounts: Record<string, number> = {};
    for (const g of grouped) accounts[g.account] = g._sum.amountCents ?? 0;

    const openDiscrepancies = await this.prisma.discrepancy.findMany({
      where: { outstandingCents: { gt: 0 } },
      select: { type: true, outstandingCents: true },
    });
    const openOver = openDiscrepancies
      .filter((d) => d.type === DiffType.OVER)
      .reduce((a, d) => a + d.outstandingCents, 0);
    const openShort = openDiscrepancies
      .filter((d) => d.type === DiffType.SHORT)
      .reduce((a, d) => a + d.outstandingCents, 0);

    const total = Object.values(accounts).reduce((a, b) => a + b, 0);
    const overSuspense = accounts[Accounts.OVER_SUSPENSE] ?? 0;
    const shortReceivable = accounts[Accounts.SHORT_RECEIVABLE] ?? 0;

    return {
      accounts,
      balanced: total === 0,
      checks: {
        // 长款待认领是贷方账户：余额 = -未认领长款合计
        overSuspenseMatchesOpenClaims: -overSuspense === openOver,
        // 短款应收是借方账户：余额 = 未缴回短款合计
        shortReceivableMatchesOpenRecoveries: shortReceivable === openShort,
      },
      open: { overCents: openOver, shortCents: openShort },
    };
  }
}
