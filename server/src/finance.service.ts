import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Disposition, ReceiptAction, User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { signedAmount } from './books.service';
import { LedgerService } from './ledger.service';
import { PrismaService } from './prisma.service';

export interface SubmitReceiptDto {
  receiptNo: string;
  dispositionId: string;
  action: ReceiptAction; // CONFIRM / REVERSAL
  amountCents: number;
}

/** 财务回执对应的账本类型与金额方向：确认记 -r，冲销记 +r */
function ledgerFor(action: ReceiptAction, d: Disposition): { kind: any; amountCents: number } {
  const r = signedAmount(d.kind, d.amountCents);
  const kindMap: Record<string, any> = {
    OVERAGE_CLAIM: 'CLAIM_OUT',
    SHORTAGE_PAYBACK: 'PAYBACK',
    SHORTAGE_STATEMENT: 'STATEMENT',
  };
  const kind = action === 'CONFIRM' ? kindMap[d.kind] : 'REVERSAL';
  return { kind, amountCents: action === 'CONFIRM' ? -r : r };
}

@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  /** 本地模拟的财务系统：为处置单签发一张回执（确认或冲销） */
  async issueMockReceipt(user: User, dispositionId: string, action: ReceiptAction) {
    if (user.role !== 'FINANCE') throw new ForbiddenException('只有财务可以操作');
    const d = await this.prisma.disposition.findUnique({ where: { id: dispositionId } });
    if (!d) throw new NotFoundException('处置单不存在');
    const receipt = {
      receiptNo: `RCPT-${randomUUID()}`,
      dispositionId: d.id,
      action,
      amountCents: d.amountCents,
    };
    return this.submitReceipt(user, receipt);
  }

  /**
   * 处理财务回执（幂等）：
   * - receiptNo 唯一，重复回执直接返回原处理结果，绝不重复确认/重复冲销；
   * - 状态推进用条件更新守卫，并发下只有一个事务生效。
   */
  async submitReceipt(user: User, dto: SubmitReceiptDto) {
    if (user.role !== 'FINANCE') throw new ForbiddenException('只有财务可以操作');
    if (!dto.receiptNo) throw new BadRequestException('缺少回执编号');

    const existing = await this.prisma.financeReceipt.findUnique({
      where: { receiptNo: dto.receiptNo },
    });
    if (existing) return { receipt: existing, duplicated: true }; // 重复回执：幂等返回，无副作用

    const disposition = await this.prisma.disposition.findUnique({
      where: { id: dto.dispositionId },
    });
    if (!disposition) throw new NotFoundException('处置单不存在');
    if (dto.amountCents !== disposition.amountCents) {
      throw new BadRequestException('回执金额与处置单金额不一致');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 状态守卫：CONFIRM 只能从 PENDING 推进；REVERSAL 只能从 CONFIRMED 推进
        const from = dto.action === 'CONFIRM' ? 'PENDING' : 'CONFIRMED';
        const to = dto.action === 'CONFIRM' ? 'CONFIRMED' : 'REVERSED';
        const guard = await tx.disposition.updateMany({
          where: { id: disposition.id, status: from },
          data: { status: to },
        });
        if (guard.count === 0) {
          throw new ConflictException(
            dto.action === 'CONFIRM' ? '处置单不在待处理状态' : '处置单未确认，无法冲销',
          );
        }

        const receipt = await tx.financeReceipt.create({
          data: {
            receiptNo: dto.receiptNo,
            dispositionId: disposition.id,
            action: dto.action,
            amountCents: dto.amountCents,
          },
        });

        const { kind, amountCents } = ledgerFor(dto.action, disposition);
        await this.ledger.post(tx, {
          businessDayId: (
            await tx.cashClosing.findUniqueOrThrow({
              where: { id: disposition.closingId },
              select: { businessDayId: true },
            })
          ).businessDayId,
          closingId: disposition.closingId,
          dispositionId: disposition.id,
          kind,
          amountCents,
          idempotencyKey: `receipt:${dto.receiptNo}`,
        });

        // 全部处置完成后结柜单结清
        if (dto.action === 'CONFIRM') {
          const pending = await tx.disposition.count({
            where: { closingId: disposition.closingId, status: 'PENDING' },
          });
          if (pending === 0) {
            await tx.cashClosing.updateMany({
              where: { id: disposition.closingId, status: 'REVIEWED' },
              data: { status: 'SETTLED' },
            });
          }
        }
        return { receipt, duplicated: false };
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // 并发下另一事务已处理同一回执：按幂等成功返回
        const receipt = await this.prisma.financeReceipt.findUnique({
          where: { receiptNo: dto.receiptNo },
        });
        if (receipt) return { receipt, duplicated: true };
      }
      throw e;
    }
  }

  async listPending() {
    return this.prisma.disposition.findMany({
      where: { status: 'PENDING' },
      include: { closing: { include: { teller: true, businessDay: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listReceipts() {
    return this.prisma.financeReceipt.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }
}
