import { Injectable } from '@nestjs/common';
import { Disposition, DispositionKind, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

/** 处置单的有符号化解金额：长款认领为正，短款缴回/责任说明为负 */
export function signedAmount(kind: DispositionKind, amountCents: number): number {
  return kind === 'OVERAGE_CLAIM' ? amountCents : -amountCents;
}

export function kindForDiff(diffCents: number, shortageKind: 'SHORTAGE_PAYBACK' | 'SHORTAGE_STATEMENT'): DispositionKind {
  return diffCents > 0 ? 'OVERAGE_CLAIM' : shortageKind;
}

/**
 * 账目一致性核心：未解决余额 = 当前差额 - 已立项处置（待处理+已确认）的有符号和。
 * 恒等式：Σ账本条目(结柜) == 当前差额 - Σ有效处置  —— 测试据此验证调整前后账目一致。
 */
@Injectable()
export class BooksService {
  constructor(private prisma: PrismaService) {}

  async outstanding(tx: Tx, closingId: string): Promise<number> {
    const closing = await tx.cashClosing.findUniqueOrThrow({ where: { id: closingId } });
    const active = await tx.disposition.findMany({
      where: { closingId, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    const resolved = active.reduce((s, d) => s + signedAmount(d.kind, d.amountCents), 0);
    return closing.diffCents - resolved;
  }

  /**
   * 调整改变了差额后，把所有 PENDING 处置单合并重立为一张，
   * 使未解决余额重新等于 outstanding。已 CONFIRMED 的单据不动。
   */
  async consolidatePending(tx: Tx, closingId: string): Promise<Disposition | null> {
    const pending = await tx.disposition.findMany({ where: { closingId, status: 'PENDING' } });
    for (const p of pending) {
      await tx.disposition.update({ where: { id: p.id }, data: { status: 'CANCELLED' } });
    }
    const outstanding = await this.outstanding(tx, closingId);
    let created: Disposition | null = null;
    if (outstanding !== 0) {
      created = await tx.disposition.create({
        data: {
          closingId,
          kind: outstanding > 0 ? 'OVERAGE_CLAIM' : 'SHORTAGE_PAYBACK',
          amountCents: Math.abs(outstanding),
        },
      });
    }
    // 没有未解决余额且已复核过 → 结柜单结清
    const stillPending = await tx.disposition.count({ where: { closingId, status: 'PENDING' } });
    const closing = await tx.cashClosing.findUniqueOrThrow({ where: { id: closingId } });
    if (closing.status === 'REVIEWED' || closing.status === 'SETTLED') {
      await tx.cashClosing.update({
        where: { id: closingId },
        data: { status: stillPending === 0 ? 'SETTLED' : 'REVIEWED' },
      });
    }
    return created;
  }
}
