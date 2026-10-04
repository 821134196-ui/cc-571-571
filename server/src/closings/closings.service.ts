import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { withTxRetry } from '../domain/tx';
import {
  Accounts,
  AdjustmentType,
  ClosingStatus,
  DENOMINATIONS,
  DiffType,
  DiscrepancyStatus,
  DayStatus,
} from '../domain/constants';

const EDITABLE_STATUSES: string[] = [ClosingStatus.DRAFT, ClosingStatus.RECOUNT_REQUIRED];

export interface CountInput {
  denomCents: number;
  qty: number;
}

@Injectable()
export class ClosingsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  /** 当前营业日（必须 OPEN，否则拒绝一切入账操作） */
  async requireOpenDay(tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const day = await tx.businessDay.findFirst({
      where: { status: DayStatus.OPEN },
      orderBy: { date: 'desc' },
    });
    if (!day) throw new ConflictException('当前没有营业中的营业日');
    return day;
  }

  private async nextNo(
    tx: Prisma.TransactionClient,
    prefix: string,
    date: string,
    count: number,
  ) {
    return `${prefix}-${date.replace(/-/g, '')}-${String(count + 1).padStart(3, '0')}`;
  }

  /**
   * 柜员开始（或获取）今日结柜单。
   * 幂等：同一现金箱同一营业日只有一张单 —— 重复结柜不会产生第二张单，
   * 并发开启时由数据库唯一约束兜底，后到者拿到既有单。
   */
  async start(user: User) {
    const box = await this.prisma.cashBox.findFirst({
      where: { tellerId: user.id },
      include: { denoms: true },
    });
    if (!box) throw new BadRequestException('当前柜员未分配现金箱');
    const day = await this.requireOpenDay();

    const existing = await this.prisma.closingSession.findUnique({
      where: { cashBoxId_businessDayId: { cashBoxId: box.id, businessDayId: day.id } },
    });
    if (existing && existing.status !== ClosingStatus.VOID) {
      return this.detail(existing.id);
    }

    const expectedCents = box.denoms.reduce((a, d) => a + d.denomCents * d.qty, 0);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await this.prisma.closingSession.create({
          data: {
            sessionNo: await this.nextNo(
              this.prisma,
              'CS',
              day.date,
              await this.prisma.closingSession.count({ where: { businessDayId: day.id } }),
            ),
            businessDayId: day.id,
            cashBoxId: box.id,
            tellerId: user.id,
            expectedCents,
            counts: {
              create: box.denoms.map((d) => ({
                denomCents: d.denomCents,
                expectedQty: d.qty,
                manualQty: 0,
              })),
            },
          },
        });
        return this.detail(created.id);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // 并发开启：另一请求已创建，直接返回既有单
          const again = await this.prisma.closingSession.findUnique({
            where: { cashBoxId_businessDayId: { cashBoxId: box.id, businessDayId: day.id } },
          });
          if (again && again.status !== ClosingStatus.VOID) return this.detail(again.id);
          continue; // sessionNo 撞号则重试
        }
        throw e;
      }
    }
    throw new ConflictException('创建结柜单失败，请重试');
  }

  async detail(id: string) {
    const closing = await this.prisma.closingSession.findUnique({
      where: { id },
      include: {
        cashBox: true,
        businessDay: true,
        counts: { orderBy: { denomCents: 'desc' } },
        discrepancy: { include: { receipts: true } },
        adjustments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!closing) throw new NotFoundException('结柜单不存在');
    return closing;
  }

  private async ownedClosing(id: string, user: User) {
    const closing = await this.prisma.closingSession.findUnique({
      where: { id },
      include: { counts: true, cashBox: true },
    });
    if (!closing) throw new NotFoundException('结柜单不存在');
    if (closing.tellerId !== user.id) throw new ForbiddenException('只能操作本人现金箱的结柜单');
    return closing;
  }

  private validateCounts(counts: CountInput[]) {
    const validDenoms = new Set(DENOMINATIONS.map((d) => d.denomCents));
    for (const c of counts) {
      if (!validDenoms.has(c.denomCents)) {
        throw new BadRequestException(`未知面额：${c.denomCents}`);
      }
      if (!Number.isInteger(c.qty) || c.qty < 0) {
        throw new BadRequestException('数量必须是非负整数');
      }
    }
  }

  /** 保存手工实盘数量（草稿 / 待复盘状态可改） */
  async saveCounts(user: User, id: string, counts: CountInput[]) {
    this.validateCounts(counts);
    const closing = await this.ownedClosing(id, user);
    if (!EDITABLE_STATUSES.includes(closing.status)) {
      throw new ConflictException('当前状态不允许修改盘点数量');
    }
    const manualCents = this.sumManual(closing, counts);
    await this.prisma.$transaction(async (tx) => {
      for (const c of counts) {
        await tx.denomCount.update({
          where: { closingId_denomCents: { closingId: id, denomCents: c.denomCents } },
          data: { manualQty: c.qty },
        });
      }
      await tx.closingSession.update({ where: { id }, data: { manualCents } });
    });
    return this.detail(id);
  }

  private sumManual(
    closing: { counts: { denomCents: number; manualQty: number }[] },
    overrides?: CountInput[],
  ) {
    const map = new Map(overrides?.map((c) => [c.denomCents, c.qty]));
    return closing.counts.reduce(
      (a, c) => a + c.denomCents * (map.get(c.denomCents) ?? c.manualQty),
      0,
    );
  }

  /** 登记点钞机结果（由模拟点钞机接口得到数量后写入） */
  async saveMachineCounts(user: User, id: string, counts: CountInput[]) {
    this.validateCounts(counts);
    const closing = await this.ownedClosing(id, user);
    if (!EDITABLE_STATUSES.includes(closing.status)) {
      throw new ConflictException('当前状态不允许登记机点数量');
    }
    const machineCents = counts.reduce((a, c) => a + c.denomCents * c.qty, 0);
    await this.prisma.$transaction(async (tx) => {
      for (const c of counts) {
        await tx.denomCount.update({
          where: { closingId_denomCents: { closingId: id, denomCents: c.denomCents } },
          data: { machineQty: c.qty },
        });
      }
      await tx.closingSession.update({ where: { id }, data: { machineCents } });
    });
    return this.detail(id);
  }

  /**
   * 提交结柜。
   * 机点与手点不一致 → 置为 RECOUNT_REQUIRED 提示复核，绝不自动采信任何一方；
   * 一致（或未使用点钞机）→ SUBMITTED，差额定格。
   */
  async submit(user: User, id: string) {
    const closing = await this.ownedClosing(id, user);
    if (!EDITABLE_STATUSES.includes(closing.status)) {
      throw new ConflictException('该结柜单已提交，不能重复提交');
    }
    const manualCents = closing.counts.reduce((a, c) => a + c.denomCents * c.manualQty, 0);
    const mismatch = closing.machineCents != null && closing.machineCents !== manualCents;

    const updated = await this.prisma.closingSession.updateMany({
      where: { id, status: { in: [ClosingStatus.DRAFT, ClosingStatus.RECOUNT_REQUIRED] } },
      data: mismatch
        ? {
            status: ClosingStatus.RECOUNT_REQUIRED,
            manualCents,
            machineMismatch: true,
            diffCents: manualCents - closing.expectedCents,
          }
        : {
            status: ClosingStatus.SUBMITTED,
            manualCents,
            machineMismatch: false,
            diffCents: manualCents - closing.expectedCents,
            submittedAt: new Date(),
          },
    });
    if (updated.count === 0) throw new ConflictException('该结柜单已被其他操作变更，请刷新');
    return this.detail(id);
  }

  /**
   * 重复结柜修正：不另开新单，以调整记录留痕（原始数量保存在 payload），
   * 修正后重新判定机点/手点一致性。
   */
  async recount(user: User, id: string, counts: CountInput[], note?: string) {
    this.validateCounts(counts);
    const day = await this.requireOpenDay();
    const closing = await this.ownedClosing(id, user);
    if (!EDITABLE_STATUSES.includes(closing.status)) {
      throw new ConflictException('当前状态不允许修正盘点');
    }
    const before = closing.counts.map((c) => ({
      denomCents: c.denomCents,
      manualQty: c.manualQty,
      machineQty: c.machineQty,
    }));
    const manualCents = this.sumManual(closing, counts);
    const mismatch = closing.machineCents != null && closing.machineCents !== manualCents;

    await withTxRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const guard = await tx.closingSession.updateMany({
          where: { id, status: { in: [ClosingStatus.DRAFT, ClosingStatus.RECOUNT_REQUIRED] } },
          data: mismatch
            ? {
                status: ClosingStatus.RECOUNT_REQUIRED,
                manualCents,
                machineMismatch: true,
                diffCents: manualCents - closing.expectedCents,
              }
            : {
                status: ClosingStatus.SUBMITTED,
                manualCents,
                machineMismatch: false,
                diffCents: manualCents - closing.expectedCents,
                submittedAt: new Date(),
              },
        });
        if (guard.count === 0) throw new ConflictException('该结柜单已被其他操作变更，请刷新');
        for (const c of counts) {
          await tx.denomCount.update({
            where: { closingId_denomCents: { closingId: id, denomCents: c.denomCents } },
            data: { manualQty: c.qty },
          });
        }
        const adjCount = await tx.adjustment.count({ where: { postedDayId: day.id } });
        await tx.adjustment.create({
          data: {
            adjustmentNo: await this.nextNo(tx, 'ADJ', day.date, adjCount),
            type: AdjustmentType.RECOUNT_CORRECTION,
            closingId: id,
            cashBoxId: closing.cashBoxId,
            note: note ?? '重复结柜修正',
            payload: JSON.stringify({ before, after: counts }),
            operatorId: user.id,
            postedDayId: day.id,
          },
        });
      }),
    );
    return this.detail(id);
  }

  /**
   * 主管复核。柜员不能复核本人结柜单；机点/手点不一致时须显式确认以手点为准并注明原因。
   * 差额在此定格入账：长款 → 待认领；短款 → 待缴回。状态机守卫保证并发复核只入账一次。
   */
  async review(reviewer: User, id: string, dto: { confirmManual?: boolean; note?: string }) {
    const closing = await this.prisma.closingSession.findUnique({
      where: { id },
      include: { cashBox: true, businessDay: true },
    });
    if (!closing) throw new NotFoundException('结柜单不存在');
    if (closing.tellerId === reviewer.id) {
      throw new ForbiddenException('柜员不能复核本人的结柜单');
    }
    if (closing.businessDay.status !== DayStatus.OPEN) {
      throw new ConflictException('该营业日已关闭，不能再复核');
    }

    const allowedFrom: string[] = [ClosingStatus.SUBMITTED];
    if (closing.status === ClosingStatus.RECOUNT_REQUIRED) {
      if (!dto.confirmManual) {
        throw new BadRequestException('机点与手点不一致：请柜员复盘，或主管注明原因后确认以手工盘点为准');
      }
      if (!dto.note?.trim()) {
        throw new BadRequestException('确认以手工盘点为准时必须填写复核说明');
      }
      allowedFrom.push(ClosingStatus.RECOUNT_REQUIRED);
    }

    await this.prisma.$transaction(async (tx) => {
      const guard = await tx.closingSession.updateMany({
        where: { id, status: { in: allowedFrom } },
        data: {
          status: ClosingStatus.REVIEWED,
          reviewedAt: new Date(),
          reviewerId: reviewer.id,
          reviewNote: dto.note,
        },
      });
      if (guard.count === 0) {
        throw new ConflictException('该结柜单已被复核，不能重复入账');
      }

      const diff = closing.diffCents;
      if (diff === 0) return;

      const type = diff > 0 ? DiffType.OVER : DiffType.SHORT;
      const amount = Math.abs(diff);
      const discrepancy = await tx.discrepancy.create({
        data: {
          closingId: id,
          cashBoxId: closing.cashBoxId,
          tellerId: closing.tellerId,
          type,
          amountCents: amount,
          outstandingCents: amount,
          status:
            type === DiffType.OVER
              ? DiscrepancyStatus.PENDING_CLAIM
              : DiscrepancyStatus.PENDING_RECOVERY,
          attributionDayId: closing.businessDayId,
        },
      });
      const cashAccount = Accounts.cash(closing.cashBox.code);
      await this.ledger.post(
        tx,
        closing.businessDayId,
        'CLOSING_REVIEW',
        discrepancy.id,
        type === DiffType.OVER
          ? [
              { account: cashAccount, amountCents: amount, memo: '长款入箱' },
              { account: Accounts.OVER_SUSPENSE, amountCents: -amount, memo: '长款待认领' },
            ]
          : [
              { account: cashAccount, amountCents: -amount, memo: '短款缺库' },
              { account: Accounts.SHORT_RECEIVABLE, amountCents: amount, memo: '短款应收缴回' },
            ],
      );
    });
    return this.detail(id);
  }

  /** 主管复核队列 / 当日全部结柜单 */
  async list(dayId?: string, status?: string) {
    return this.prisma.closingSession.findMany({
      where: {
        ...(dayId ? { businessDayId: dayId } : {}),
        ...(status ? { status } : {}),
      },
      include: { cashBox: true, discrepancy: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
