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

export interface DenomLineInput {
  denomCents: number;
  expectedQty: number;
  manualQty: number;
  machineQty?: number | null;
}

export interface CreateClosingDto {
  shift: string;
  lines: DenomLineInput[];
}

function validateLines(lines: DenomLineInput[]) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new BadRequestException('面额明细不能为空');
  }
  for (const l of lines) {
    for (const [k, v] of Object.entries({ denomCents: l.denomCents, expectedQty: l.expectedQty, manualQty: l.manualQty })) {
      if (!Number.isInteger(v) || (v as number) < 0) throw new BadRequestException(`明细字段 ${k} 必须是非负整数`);
    }
    if (l.machineQty != null && (!Number.isInteger(l.machineQty) || l.machineQty < 0)) {
      throw new BadRequestException('machineQty 必须是非负整数');
    }
  }
}

@Injectable()
export class ClosingsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  async currentOpenDay() {
    return this.prisma.businessDay.findFirst({ where: { status: 'OPEN' } });
  }

  /**
   * 柜员结柜登记：按面额填写应有/实盘数量，系统计算长短款。
   * 机器点钞与手工盘点不一致 → 标记 countConflict，提示复核，
   * 不自动采用任何一方结果（须通过修正记录确认后才可复核）。
   */
  async create(user: User, dto: CreateClosingDto) {
    if (user.role !== 'TELLER') throw new ForbiddenException('只有柜员可以登记结柜');
    if (!dto.shift || typeof dto.shift !== 'string') throw new BadRequestException('缺少班次');
    validateLines(dto.lines);

    const day = await this.currentOpenDay();
    if (!day) throw new ConflictException('当前没有营业中的营业日，无法结柜');

    const expectedCents = dto.lines.reduce((s, l) => s + l.denomCents * l.expectedQty, 0);
    const manualCents = dto.lines.reduce((s, l) => s + l.denomCents * l.manualQty, 0);
    const machineProvided = dto.lines.every((l) => l.machineQty != null);
    const machineCents = machineProvided
      ? dto.lines.reduce((s, l) => s + l.denomCents * (l.machineQty as number), 0)
      : null;
    // 机器与手工不一致：仅提示，不自动认定任何一方正确
    const countConflict = machineCents != null && machineCents !== manualCents;

    try {
      const closing = await this.prisma.$transaction(async (tx) => {
        const created = await tx.cashClosing.create({
          data: {
            businessDayId: day.id,
            tellerId: user.id,
            shift: dto.shift,
            expectedCents,
            actualCents: manualCents,
            diffCents: manualCents - expectedCents,
            countConflict,
            lines: {
              create: dto.lines.map((l) => ({
                denomCents: l.denomCents,
                expectedQty: l.expectedQty,
                manualQty: l.manualQty,
                machineQty: l.machineQty ?? null,
                finalQty: l.manualQty, // 确认数量默认取手工，修正记录可改
              })),
            },
          },
          include: { lines: true },
        });
        // 登记差额账：幂等键保证一张结柜单只记一笔，此后账目恒等式全程成立
        await this.ledger.post(tx, {
          businessDayId: day.id,
          closingId: created.id,
          kind: 'CLOSING_DIFF',
          amountCents: created.diffCents,
          idempotencyKey: `closing:${created.id}:diff`,
        });
        return created;
      });
      return { ...closing, machineCents, warning: countConflict ? '机器点钞与手工盘点不一致，请复核确认' : null };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // 唯一约束 (营业日, 柜员, 班次)：并发/重复提交只成功一次
        throw new ConflictException('本营业日本班次已存在结柜单，禁止重复结柜');
      }
      throw e;
    }
  }

  async detail(id: string) {
    const closing = await this.prisma.cashClosing.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { denomCents: 'desc' } },
        reviews: { include: { reviewer: true }, orderBy: { createdAt: 'desc' } },
        adjustments: { orderBy: { createdAt: 'asc' } },
        dispositions: { orderBy: { createdAt: 'asc' } },
        ledgerEntries: { orderBy: { createdAt: 'asc' } },
        teller: true,
        businessDay: true,
      },
    });
    if (!closing) throw new NotFoundException('结柜单不存在');
    return closing;
  }

  async listMine(user: User) {
    return this.prisma.cashClosing.findMany({
      where: { tellerId: user.id },
      include: { businessDay: true, dispositions: true, adjustments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPendingReview() {
    return this.prisma.cashClosing.findMany({
      where: { status: 'SUBMITTED' },
      include: { teller: true, businessDay: true, lines: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
