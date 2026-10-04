import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { LedgerService } from './ledger.service';
import { PrismaService } from './prisma.service';
import { signedAmount } from './books.service';

@Injectable()
export class DaysService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  current() {
    return this.prisma.businessDay.findFirst({ where: { status: 'OPEN' } });
  }

  async list() {
    return this.prisma.businessDay.findMany({ orderBy: { date: 'desc' } });
  }

  /** 财务关闭营业日：必须没有未处理事项（未复核/未确认/未解决的冲突） */
  async closeCurrent(user: User) {
    if (user.role !== 'FINANCE') throw new ForbiddenException('只有财务可以关闭营业日');
    const day = await this.current();
    if (!day) throw new ConflictException('当前没有营业中的营业日');

    const [unreviewed, conflicts, pendingDispositions] = await Promise.all([
      this.prisma.cashClosing.count({
        where: { businessDayId: day.id, status: { in: ['SUBMITTED', 'REJECTED'] } },
      }),
      this.prisma.cashClosing.count({ where: { businessDayId: day.id, countConflict: true } }),
      this.prisma.disposition.count({
        where: { status: 'PENDING', closing: { businessDayId: day.id } },
      }),
    ]);
    if (unreviewed > 0 || conflicts > 0 || pendingDispositions > 0) {
      throw new ConflictException(
        `存在未处理事项，不能关闭营业日：未复核 ${unreviewed} 笔，机器/手工冲突 ${conflicts} 笔，待财务确认 ${pendingDispositions} 笔`,
      );
    }
    return this.prisma.businessDay.update({
      where: { id: day.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }

  /** 开启下一个营业日（前一营业日必须先关闭） */
  async openNext(user: User, date: string) {
    if (user.role !== 'FINANCE') throw new ForbiddenException('只有财务可以开启营业日');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('日期格式应为 YYYY-MM-DD');
    const open = await this.current();
    if (open) throw new ConflictException('仍有营业中的营业日，请先关闭');
    try {
      return await this.prisma.businessDay.create({ data: { date } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('该日期的营业日已存在');
      throw e;
    }
  }

  /**
   * 营业日报告：按归属营业日汇总。
   * 跨日调整（事后找到现金等）的账本条目记在原营业日，在此体现归属。
   */
  async report(dayId: string) {
    const day = await this.prisma.businessDay.findUnique({ where: { id: dayId } });
    if (!day) throw new NotFoundException('营业日不存在');
    const closings = await this.prisma.cashClosing.findMany({
      where: { businessDayId: dayId },
      include: { teller: true, dispositions: true, adjustments: true },
      orderBy: { createdAt: 'asc' },
    });
    const ledger = await this.ledger.sumForDay(dayId);
    // 未解决现金余额 = 当前差额 - 已确认处置（待处理尚未发生现金收付）
    let outstanding = 0;
    for (const c of closings) {
      const resolved = c.dispositions
        .filter((d) => d.status === 'CONFIRMED')
        .reduce((s, d) => s + signedAmount(d.kind, d.amountCents), 0);
      outstanding += c.diffCents - resolved;
    }
    return {
      day,
      closings,
      totals: {
        count: closings.length,
        expectedCents: closings.reduce((s, c) => s + c.expectedCents, 0),
        actualCents: closings.reduce((s, c) => s + c.actualCents, 0),
        diffCents: closings.reduce((s, c) => s + c.diffCents, 0),
        outstandingCents: outstanding,
      },
      ledger,
    };
  }
}
