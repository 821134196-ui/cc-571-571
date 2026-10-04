import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ClosingStatus, DayStatus } from '../domain/constants';

@Injectable()
export class DaysService {
  constructor(private prisma: PrismaService) {}

  async current() {
    const day = await this.prisma.businessDay.findFirst({ orderBy: { date: 'desc' } });
    if (!day) throw new NotFoundException('尚未开立任何营业日');
    return day;
  }

  /**
   * 关闭营业日。前置条件（财务确认全部未处理事项）：
   *  1. 不存在待复核/待复盘的结柜单；
   *  2. 所有未了结的长短款均已由财务确认挂账（financeAckedAt）。
   * 状态机守卫保证并发日结只成功一次。
   */
  async close(user: User, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const day = await tx.businessDay.findUnique({ where: { id } });
      if (!day) throw new NotFoundException('营业日不存在');
      if (day.status !== DayStatus.OPEN) throw new ConflictException('该营业日已关闭');

      const pendingClosings = await tx.closingSession.findMany({
        where: {
          businessDayId: id,
          status: { in: [ClosingStatus.SUBMITTED, ClosingStatus.RECOUNT_REQUIRED] },
        },
        include: { cashBox: true },
      });
      if (pendingClosings.length > 0) {
        throw new ConflictException({
          message: '存在未复核的结柜单，不能关闭营业日',
          closings: pendingClosings.map((c) => ({
            sessionNo: c.sessionNo,
            cashBox: c.cashBox.code,
            status: c.status,
          })),
        });
      }

      // 未了结且未经财务确认的事项（含以往营业日结转下来的）
      const unacked = await tx.discrepancy.findMany({
        where: { outstandingCents: { gt: 0 }, financeAckedAt: null },
        include: { attributionDay: true },
      });
      if (unacked.length > 0) {
        throw new ConflictException({
          message: '存在财务尚未确认的未处理事项，不能关闭营业日',
          discrepancies: unacked.map((d) => ({
            id: d.id,
            type: d.type,
            outstandingCents: d.outstandingCents,
            attributionDate: d.attributionDay.date,
          })),
        });
      }

      // 未提交的草稿单作废
      await tx.closingSession.updateMany({
        where: { businessDayId: id, status: ClosingStatus.DRAFT },
        data: { status: ClosingStatus.VOID },
      });

      const guard = await tx.businessDay.updateMany({
        where: { id, status: DayStatus.OPEN },
        data: { status: DayStatus.CLOSED, closedAt: new Date(), closedById: user.id },
      });
      if (guard.count === 0) throw new ConflictException('该营业日已被其他操作关闭');

      const carried = await tx.discrepancy.findMany({
        where: { outstandingCents: { gt: 0 } },
        include: { attributionDay: true },
      });
      return {
        closed: true,
        date: day.date,
        carriedDiscrepancies: carried.map((d) => ({
          id: d.id,
          type: d.type,
          outstandingCents: d.outstandingCents,
          attributionDate: d.attributionDay.date, // 跨日结转，保留归属日
        })),
      };
    });
  }

  /** 开立下一营业日（上一日必须已关闭） */
  async openNext(user: User) {
    const latest = await this.prisma.businessDay.findFirst({ orderBy: { date: 'desc' } });
    if (!latest) throw new NotFoundException('尚未开立任何营业日');
    if (latest.status !== DayStatus.CLOSED) {
      throw new ConflictException('当前营业日尚未关闭，不能开立下一日');
    }
    const next = new Date(`${latest.date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const y = next.getFullYear();
    const m = String(next.getMonth() + 1).padStart(2, '0');
    const d = String(next.getDate()).padStart(2, '0');
    const date = `${y}-${m}-${d}`;
    try {
      return await this.prisma.businessDay.create({ data: { date, status: DayStatus.OPEN } });
    } catch {
      throw new ConflictException(`营业日 ${date} 已存在`);
    }
  }

  async list() {
    return this.prisma.businessDay.findMany({ orderBy: { date: 'desc' } });
  }
}
