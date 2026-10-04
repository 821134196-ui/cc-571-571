import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdjustmentType, Prisma, User } from '@prisma/client';
import { BooksService } from './books.service';
import { LedgerService } from './ledger.service';
import { PrismaService } from './prisma.service';

export interface AdjustmentLineInput {
  denomCents: number;
  finalQty: number;
}

export interface CreateAdjustmentDto {
  type: AdjustmentType; // CORRECTION 修正 / HANDOVER 跨班交接 / FOUND_CASH 事后找到现金
  note?: string;
  deltaCents?: number; // FOUND_CASH / HANDOVER 必填
  lines?: AdjustmentLineInput[]; // CORRECTION：修正后的确认数量
}

/**
 * 调整记录：重复结柜修正、跨班交接差异、事后找到现金，全部通过调整处理。
 * 跨日录入时 originBusinessDayId 保留差额归属营业日，账本条目也记在原营业日。
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private books: BooksService,
  ) {}

  async add(user: User, closingId: string, dto: CreateAdjustmentDto) {
    const closing = await this.prisma.cashClosing.findUnique({
      where: { id: closingId },
      include: { lines: true },
    });
    if (!closing) throw new NotFoundException('结柜单不存在');
    if (user.role === 'TELLER' && closing.tellerId !== user.id) {
      throw new ForbiddenException('只能调整本人的结柜单');
    }
    if (user.role !== 'TELLER' && user.role !== 'SUPERVISOR') {
      throw new ForbiddenException('只有柜员或主管可以登记调整');
    }
    if (!['CORRECTION', 'HANDOVER', 'FOUND_CASH'].includes(dto.type)) {
      throw new BadRequestException('未知的调整类型');
    }

    // 计算调整量与面额快照
    let deltaCents: number;
    let linesSnapshot: any = null;
    if (dto.type === 'CORRECTION') {
      if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
        throw new BadRequestException('修正记录必须包含面额明细');
      }
      const byDenom = new Map(dto.lines.map((l) => [l.denomCents, l.finalQty]));
      for (const [denom, qty] of byDenom) {
        if (!Number.isInteger(qty) || qty < 0 || !Number.isInteger(denom) || denom <= 0) {
          throw new BadRequestException('修正明细数量必须是非负整数');
        }
      }
      const newActual = closing.lines.reduce(
        (s, l) => s + l.denomCents * (byDenom.get(l.denomCents) ?? l.finalQty),
        0,
      );
      deltaCents = newActual - closing.actualCents;
      linesSnapshot = {
        before: closing.lines.map((l) => ({ denomCents: l.denomCents, finalQty: l.finalQty })),
        after: closing.lines.map((l) => ({
          denomCents: l.denomCents,
          finalQty: byDenom.get(l.denomCents) ?? l.finalQty,
        })),
      };
    } else {
      if (!Number.isInteger(dto.deltaCents) || dto.deltaCents === 0) {
        throw new BadRequestException('调整金额必须是非零整数（分）');
      }
      deltaCents = dto.deltaCents as number;
    }

    const openDay = await this.prisma.businessDay.findFirst({ where: { status: 'OPEN' } });

    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.adjustment.create({
        data: {
          closingId,
          type: dto.type,
          originBusinessDayId: closing.businessDayId, // 归属原营业日（跨日保留归属）
          createdBusinessDayId: openDay?.id ?? closing.businessDayId,
          note: dto.note ?? null,
          deltaCents,
          linesJson: linesSnapshot ? JSON.stringify(linesSnapshot) : null,
          createdById: user.id,
        },
      });

      // 更新结柜单确认数量与差额；修正记录可消除机器/手工冲突标记
      if (dto.type === 'CORRECTION' && linesSnapshot) {
        for (const line of linesSnapshot.after) {
          await tx.denomLine.updateMany({
            where: { closingId, denomCents: line.denomCents },
            data: { finalQty: line.finalQty },
          });
        }
      }
      const newStatus =
        closing.status === 'REJECTED' && dto.type === 'CORRECTION' ? 'SUBMITTED' : closing.status;
      await tx.cashClosing.update({
        where: { id: closingId },
        data: {
          actualCents: closing.actualCents + deltaCents,
          diffCents: closing.diffCents + deltaCents,
          countConflict: dto.type === 'CORRECTION' ? false : closing.countConflict,
          status: newStatus,
        },
      });

      // 账本：记在原营业日（归属），幂等键防重复入账
      await this.ledger.post(tx, {
        businessDayId: closing.businessDayId,
        closingId,
        adjustmentId: adjustment.id,
        kind: 'ADJUSTMENT',
        amountCents: deltaCents,
        idempotencyKey: `adjustment:${adjustment.id}`,
      });

      // 已复核的结柜单：重立待处理处置单，保持未解决余额一致
      let newDisposition = null;
      if (closing.status === 'REVIEWED' || closing.status === 'SETTLED') {
        newDisposition = await this.books.consolidatePending(tx, closingId);
      }
      return { adjustment, newDisposition };
    });
  }

  async listForClosing(closingId: string) {
    return this.prisma.adjustment.findMany({
      where: { closingId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
