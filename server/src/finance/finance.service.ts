import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { ClosingsService } from '../closings/closings.service';
import { Accounts, DiffType, ReceiptStatus } from '../domain/constants';

@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private closings: ClosingsService,
  ) {}

  /**
   * 处理财务回执 —— 幂等。
   * receiptNo 是幂等键：重复回执直接返回原记录（status=DUPLICATE），绝不再次冲销；
   * 并发到达的同号回执由唯一约束兜底，后到者按重复处理。
   */
  async applyReceipt(user: User, dto: { receiptNo: string; discrepancyId: string; amountCents: number }) {
    if (!dto.receiptNo?.trim()) throw new BadRequestException('回执号不能为空');
    if (!Number.isInteger(dto.amountCents) || dto.amountCents <= 0) {
      throw new BadRequestException('回执金额必须是正整数（分）');
    }
    const day = await this.closings.requireOpenDay();

    const existing = await this.prisma.financeReceipt.findUnique({
      where: { receiptNo: dto.receiptNo },
    });
    if (existing) {
      return { receipt: existing, duplicate: true, message: '重复回执，已按原处理结果返回，未再次冲销' };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 事务内再查一次（并发窗口兜底）
        const dup = await tx.financeReceipt.findUnique({ where: { receiptNo: dto.receiptNo } });
        if (dup) {
          return { receipt: dup, duplicate: true, message: '重复回执，已按原处理结果返回，未再次冲销' };
        }
        // 先占位创建回执行：唯一约束使并发同号回执串行化；
        // 后续校验失败则整体回滚，占位行随之消失
        const receipt = await tx.financeReceipt.create({
          data: {
            receiptNo: dto.receiptNo,
            discrepancyId: dto.discrepancyId,
            amountCents: dto.amountCents,
            status: ReceiptStatus.APPLIED,
          },
        });

        const d = await tx.discrepancy.findUnique({
          where: { id: dto.discrepancyId },
          include: { closing: { include: { cashBox: true } } },
        });
        if (!d) throw new NotFoundException('长短款记录不存在');
        if (d.type !== DiffType.SHORT) throw new BadRequestException('财务回执仅适用于短款缴回');

        // 已缴回但未确认的金额 = 总额 - 未了余额 - 已确认
        const unconfirmed = d.amountCents - d.outstandingCents - d.confirmedCents;
        if (dto.amountCents > unconfirmed) {
          throw new BadRequestException(`回执金额超过未确认的缴回金额（可确认 ${unconfirmed} 分）`);
        }

        await tx.discrepancy.update({
          where: { id: d.id },
          data: { confirmedCents: { increment: dto.amountCents } },
        });
        // 缴回的现金随回执上缴财务金库
        await this.ledger.post(tx, day.id, 'FINANCE_RECEIPT', receipt.id, [
          {
            account: Accounts.cash(d.closing.cashBox.code),
            amountCents: -dto.amountCents,
            memo: '缴回款上缴',
          },
          { account: Accounts.FINANCE_VAULT, amountCents: dto.amountCents, memo: '财务金库收讫' },
        ]);
        return { receipt, duplicate: false };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // 并发同号回执：按重复处理，不再次冲销
        const dup = await this.prisma.financeReceipt.findUnique({
          where: { receiptNo: dto.receiptNo },
        });
        return { receipt: dup, duplicate: true, message: '重复回执，已按原处理结果返回，未再次冲销' };
      }
      throw e;
    }
  }

  async receipts() {
    return this.prisma.financeReceipt.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
