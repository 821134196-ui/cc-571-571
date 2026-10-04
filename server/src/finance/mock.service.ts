import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ClosingsService } from '../closings/closings.service';
import { FinanceService } from './finance.service';

/**
 * 本地模拟外部系统：
 *  - 点钞机：按实盘数量生成机点结果（可传入显式数量以做确定性演示/测试）；
 *  - 财务接口：模拟财务系统回执回调（可指定回执号以演示重复回执幂等）。
 */
@Injectable()
export class MockService {
  constructor(
    private prisma: PrismaService,
    private closings: ClosingsService,
    private finance: FinanceService,
  ) {}

  /** 模拟点钞机清点。显式传入 counts 时直接采用（演示/测试用）。 */
  async machineCount(
    user: User,
    body: { closingId: string; counts?: { denomCents: number; qty: number }[] },
  ) {
    const closing = await this.prisma.closingSession.findUnique({
      where: { id: body.closingId },
      include: { counts: { orderBy: { denomCents: 'desc' } } },
    });
    if (!closing) throw new NotFoundException('结柜单不存在');

    let counts = body.counts;
    if (!counts) {
      // 模拟真实点钞机：以手工实盘为基准，小概率在某一面额上多数/少数一张
      counts = closing.counts.map((c) => ({ denomCents: c.denomCents, qty: c.manualQty }));
      if (Math.random() < 0.3 && counts.length > 0) {
        const idx = Math.floor(Math.random() * counts.length);
        counts[idx] = {
          denomCents: counts[idx].denomCents,
          qty: Math.max(0, counts[idx].qty + (Math.random() < 0.5 ? 1 : -1)),
        };
      }
    }
    const totalCents = counts.reduce((a, c) => a + c.denomCents * c.qty, 0);
    return { closingId: closing.id, counts, totalCents, source: 'MOCK_MACHINE' };
  }

  /** 模拟财务系统发送回执（不指定回执号则自动生成） */
  async sendReceipt(
    user: User,
    body: { receiptNo?: string; discrepancyId: string; amountCents: number },
  ) {
    if (!body.discrepancyId) throw new BadRequestException('缺少 discrepancyId');
    const receiptNo =
      body.receiptNo ?? `FR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    return this.finance.applyReceipt(user, {
      receiptNo,
      discrepancyId: body.discrepancyId,
      amountCents: body.amountCents,
    });
  }
}
