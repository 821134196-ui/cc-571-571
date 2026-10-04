import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { ClosingsService } from '../closings/closings.service';
import { withTxRetry } from '../domain/tx';
import {
  Accounts,
  AdjustmentType,
  DiffType,
  DiscrepancyStatus,
} from '../domain/constants';

@Injectable()
export class DiscrepanciesService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private closings: ClosingsService,
  ) {}

  async list(status?: string) {
    return this.prisma.discrepancy.findMany({
      where: status ? { status } : {},
      include: {
        closing: { include: { cashBox: true } },
        attributionDay: true,
        receipts: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(id: string) {
    const d = await this.prisma.discrepancy.findUnique({
      where: { id },
      include: {
        closing: { include: { cashBox: true, counts: { orderBy: { denomCents: 'desc' } } } },
        attributionDay: true,
        adjustments: { orderBy: { createdAt: 'asc' } },
        receipts: true,
      },
    });
    if (!d) throw new NotFoundException('长短款记录不存在');
    return d;
  }

  /**
   * 通用「减少未了余额」骨架：条件更新（乐观锁）+ 调整记录 + 台账，同一事务。
   * 并发操作时只有一方能把 outstandingBefore → outstandingAfter，另一方 409。
   */
  private async reduceOutstanding(
    user: User,
    id: string,
    amountCents: number,
    allowedStatuses: string[],
    build: (ctx: {
      d: any;
      day: any;
      newOutstanding: number;
      newStatus: string;
    }) => {
      adjustmentType: string;
      note?: string;
      payload?: object;
      ledger: { account: string; amountCents: number; memo?: string }[];
    },
  ) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BadRequestException('金额必须是正整数（分）');
    }
    const day = await this.closings.requireOpenDay();

    await withTxRetry(() =>
      this.prisma.$transaction(async (tx) => {
      const d = await tx.discrepancy.findUnique({
        where: { id },
        include: { closing: { include: { cashBox: true } } },
      });
      if (!d) throw new NotFoundException('长短款记录不存在');
      if (!allowedStatuses.includes(d.status)) {
        throw new ConflictException(`当前状态（${d.status}）不允许该操作`);
      }
      if (amountCents > d.outstandingCents) {
        throw new BadRequestException(`金额超过未了余额（剩余 ${d.outstandingCents} 分）`);
      }

      const newOutstanding = d.outstandingCents - amountCents;
      const newStatus =
        newOutstanding === 0
          ? d.type === DiffType.OVER
            ? DiscrepancyStatus.CLAIMED
            : DiscrepancyStatus.RECOVERED
          : d.status === DiscrepancyStatus.RESPONSIBILITY_FILED
            ? DiscrepancyStatus.RESPONSIBILITY_FILED
            : d.type === DiffType.OVER
              ? DiscrepancyStatus.PENDING_CLAIM
              : DiscrepancyStatus.PENDING_RECOVERY;

      const plan = build({ d, day, newOutstanding, newStatus });

      // 乐观锁：只有余额未被他人改动时才能推进
      const guard = await tx.discrepancy.updateMany({
        where: { id, outstandingCents: d.outstandingCents, status: d.status },
        data: { outstandingCents: newOutstanding, status: newStatus },
      });
      if (guard.count === 0) {
        throw new ConflictException('该记录正被其他操作处理，请刷新后重试');
      }

      const adjCount = await tx.adjustment.count({ where: { postedDayId: day.id } });
      const adjustment = await tx.adjustment.create({
        data: {
          adjustmentNo: `ADJ-${day.date.replace(/-/g, '')}-${String(adjCount + 1).padStart(3, '0')}`,
          type: plan.adjustmentType,
          closingId: d.closingId,
          discrepancyId: d.id,
          cashBoxId: d.cashBoxId,
          amountCents: -amountCents,
          outstandingBefore: d.outstandingCents,
          outstandingAfter: newOutstanding,
          note: plan.note,
          payload: plan.payload ? JSON.stringify(plan.payload) : null,
          operatorId: user.id,
          postedDayId: day.id, // 入账当日；归属日 attributionDayId 保持不变 → 跨日差额保留归属
        },
      });

      await this.ledger.post(tx, day.id, 'ADJUSTMENT', adjustment.id, plan.ledger);
      }),
    );
    return this.detail(id);
  }

  /** 长款认领：向认领人付出现金 */
  async claim(user: User, id: string, amountCents: number, claimant: string, note?: string) {
    if (!claimant?.trim()) throw new BadRequestException('必须填写认领人');
    return this.reduceOutstanding(user, id, amountCents, [DiscrepancyStatus.PENDING_CLAIM], ({ d }) => ({
      adjustmentType: AdjustmentType.CLAIM_PAYOUT,
      note: note ?? `长款认领：${claimant}`,
      payload: { claimant },
      ledger: [
        { account: Accounts.cash(d.closing.cashBox.code), amountCents: -amountCents, memo: '认领付出' },
        { account: Accounts.OVER_SUSPENSE, amountCents: amountCents, memo: '冲销待认领长款' },
      ],
    }));
  }

  /** 短款缴回：柜员补缴现金 */
  async recover(user: User, id: string, amountCents: number, note?: string) {
    return this.reduceOutstanding(
      user,
      id,
      amountCents,
      [DiscrepancyStatus.PENDING_RECOVERY, DiscrepancyStatus.RESPONSIBILITY_FILED],
      ({ d }) => ({
        adjustmentType: AdjustmentType.RECOVERY_PAYMENT,
        note: note ?? '短款缴回',
        ledger: [
          { account: Accounts.cash(d.closing.cashBox.code), amountCents: amountCents, memo: '缴回入箱' },
          { account: Accounts.SHORT_RECEIVABLE, amountCents: -amountCents, memo: '冲销短款应收' },
        ],
      }),
    );
  }

  /**
   * 事后找到现金：可能发生在若干营业日之后。
   * 调整记录落在当前营业日（postedDayId），差额归属日（attributionDayId）不变 —— 跨日保留归属。
   */
  async foundCash(user: User, id: string, amountCents: number, note: string) {
    if (!note?.trim()) throw new BadRequestException('必须说明现金找到的位置/经过');
    return this.reduceOutstanding(
      user,
      id,
      amountCents,
      [DiscrepancyStatus.PENDING_RECOVERY, DiscrepancyStatus.RESPONSIBILITY_FILED],
      ({ d }) => ({
        adjustmentType: AdjustmentType.CASH_FOUND,
        note,
        ledger: [
          { account: Accounts.cash(d.closing.cashBox.code), amountCents: amountCents, memo: '找回现金入箱' },
          { account: Accounts.SHORT_RECEIVABLE, amountCents: -amountCents, memo: '冲销短款应收' },
        ],
      }),
    );
  }

  /** 短款责任说明：不产生现金流动，仅留痕；余额仍挂账待缴回/找回 */
  async fileResponsibility(user: User, id: string, note: string) {
    if (!note?.trim()) throw new BadRequestException('责任说明不能为空');
    const day = await this.closings.requireOpenDay();
    await withTxRetry(() =>
      this.prisma.$transaction(async (tx) => {
      const d = await tx.discrepancy.findUnique({ where: { id } });
      if (!d) throw new NotFoundException('长短款记录不存在');
      if (d.type !== DiffType.SHORT) throw new BadRequestException('只有短款可以填写责任说明');
      const guard = await tx.discrepancy.updateMany({
        where: { id, status: DiscrepancyStatus.PENDING_RECOVERY },
        data: { status: DiscrepancyStatus.RESPONSIBILITY_FILED, responsibilityNote: note },
      });
      if (guard.count === 0) throw new ConflictException('当前状态不允许填写责任说明');
      const adjCount = await tx.adjustment.count({ where: { postedDayId: day.id } });
      await tx.adjustment.create({
        data: {
          adjustmentNo: `ADJ-${day.date.replace(/-/g, '')}-${String(adjCount + 1).padStart(3, '0')}`,
          type: AdjustmentType.RESPONSIBILITY_NOTE,
          closingId: d.closingId,
          discrepancyId: d.id,
          cashBoxId: d.cashBoxId,
          amountCents: 0,
          outstandingBefore: d.outstandingCents,
          outstandingAfter: d.outstandingCents,
          note,
          operatorId: user.id,
          postedDayId: day.id,
        },
      });
      }),
    );
    return this.detail(id);
  }

  /** 财务确认未处理事项（确认挂账后，营业日方可在该事项未了结的情况下关闭） */
  async ack(user: User, id: string) {
    const d = await this.prisma.discrepancy.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('长短款记录不存在');
    if (d.outstandingCents === 0) throw new BadRequestException('该事项已了结，无需确认');
    if (d.financeAckedAt) return this.detail(id); // 幂等
    await this.prisma.discrepancy.update({
      where: { id },
      data: { financeAckedAt: new Date() },
    });
    return this.detail(id);
  }

  /** 跨班交接：以调整记录留痕，现金箱移交下一班柜员；不产生现金流动 */
  async handover(
    user: User,
    dto: { cashBoxId: string; toTellerId: string; counts: { denomCents: number; qty: number }[]; note?: string },
  ) {
    const day = await this.closings.requireOpenDay();
    return this.prisma.$transaction(async (tx) => {
      const box = await tx.cashBox.findUnique({
        where: { id: dto.cashBoxId },
        include: { denoms: true, teller: true },
      });
      if (!box) throw new NotFoundException('现金箱不存在');
      if (box.tellerId !== user.id) throw new ConflictException('只有当前持箱柜员可以办理交接');
      const toTeller = await tx.user.findUnique({ where: { id: dto.toTellerId } });
      if (!toTeller || toTeller.role !== 'TELLER') {
        throw new BadRequestException('接收人必须是在岗柜员');
      }
      if (toTeller.id === user.id) throw new BadRequestException('不能交接给本人');

      const countedCents = dto.counts.reduce((a, c) => a + c.denomCents * c.qty, 0);
      const expectedCents = box.denoms.reduce((a, dd) => a + dd.denomCents * dd.qty, 0);

      await tx.cashBox.update({ where: { id: box.id }, data: { tellerId: toTeller.id } });
      // 若本日已有未提交的结柜草稿，一并移交给接班柜员
      await tx.closingSession.updateMany({
        where: { cashBoxId: box.id, businessDayId: day.id, status: 'DRAFT' },
        data: { tellerId: toTeller.id },
      });

      const adjCount = await tx.adjustment.count({ where: { postedDayId: day.id } });
      await tx.adjustment.create({
        data: {
          adjustmentNo: `ADJ-${day.date.replace(/-/g, '')}-${String(adjCount + 1).padStart(3, '0')}`,
          type: AdjustmentType.HANDOVER,
          cashBoxId: box.id,
          note: dto.note ?? `跨班交接：${box.teller.name} → ${toTeller.name}`,
          payload: JSON.stringify({
            fromTellerId: user.id,
            toTellerId: toTeller.id,
            countedCents,
            expectedCents,
            counts: dto.counts,
          }),
          operatorId: user.id,
          postedDayId: day.id,
        },
      });
      return { ok: true, countedCents, expectedCents, warning: countedCents !== expectedCents };
    });
  }
}
