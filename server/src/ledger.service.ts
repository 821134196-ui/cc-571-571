import { Injectable } from '@nestjs/common';
import { LedgerKind, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

export interface PostEntry {
  businessDayId: string; // 归属营业日（跨日调整记在原营业日）
  closingId?: string;
  dispositionId?: string;
  adjustmentId?: string;
  kind: LedgerKind;
  amountCents: number;
  idempotencyKey: string;
}

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  /**
   * 入账。idempotencyKey 唯一约束保证并发/重试不会重复入账：
   * 冲突时返回已存在的条目而不是再记一笔。
   */
  async post(tx: Tx, entry: PostEntry) {
    try {
      return await tx.ledgerEntry.create({ data: entry });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return tx.ledgerEntry.findUnique({ where: { idempotencyKey: entry.idempotencyKey } });
      }
      throw e;
    }
  }

  async sumForClosing(closingId: string): Promise<number> {
    const agg = await this.prisma.ledgerEntry.aggregate({
      _sum: { amountCents: true },
      where: { closingId },
    });
    return agg._sum.amountCents ?? 0;
  }

  async sumForDay(businessDayId: string) {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['kind'],
      _sum: { amountCents: true },
      where: { businessDayId },
    });
    const byKind: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byKind[r.kind] = r._sum.amountCents ?? 0;
      total += r._sum.amountCents ?? 0;
    }
    return { byKind, total };
  }
}
