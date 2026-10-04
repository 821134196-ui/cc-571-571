import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { kindForDiff } from './books.service';
import { PrismaService } from './prisma.service';

export interface ReviewDto {
  closingId: string;
  decision: 'APPROVE' | 'REJECT';
  comment?: string;
  shortageKind?: 'SHORTAGE_PAYBACK' | 'SHORTAGE_STATEMENT'; // 短款处置方式，默认缴回
}

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 主管复核。规则：
   * - 柜员不能复核本人结柜单；
   * - 机器/手工不一致未确认前不得复核通过；
   * - 并发复核只成功一次（状态守卫 + Review.closingId 唯一约束）；
   * - 通过后生成处置单（长款→待认领，短款→缴回或责任说明）并记差额账。
   */
  async review(user: User, dto: ReviewDto) {
    if (user.role !== 'SUPERVISOR') throw new ForbiddenException('只有主管可以复核');
    const closing = await this.prisma.cashClosing.findUnique({ where: { id: dto.closingId } });
    if (!closing) throw new NotFoundException('结柜单不存在');
    if (closing.tellerId === user.id) throw new ForbiddenException('柜员不能复核本人结柜单');
    if (dto.decision === 'APPROVE' && closing.countConflict) {
      throw new ConflictException('机器点钞与手工盘点不一致，请先通过修正记录确认数量');
    }

    return this.prisma.$transaction(async (tx) => {
      // 状态守卫：只有 SUBMITTED 能被复核，并发下只有一个事务能推进
      const guard = await tx.cashClosing.updateMany({
        where: { id: closing.id, status: 'SUBMITTED' },
        data: { status: dto.decision === 'APPROVE' ? 'REVIEWED' : 'REJECTED' },
      });
      if (guard.count === 0) throw new ConflictException('该结柜单已被复核或状态不允许复核');

      let review;
      try {
        review = await tx.review.create({
          data: {
            closingId: closing.id,
            reviewerId: user.id,
            decision: dto.decision,
            comment: dto.comment ?? null,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') throw new ConflictException('该结柜单已存在复核结论');
        throw e;
      }

      let disposition = null;
      if (dto.decision === 'APPROVE') {
        // 差额账已在结柜登记时入账（幂等键 closing:{id}:diff），此处生成立项处置单
        if (closing.diffCents !== 0) {
          disposition = await tx.disposition.create({
            data: {
              closingId: closing.id,
              kind: kindForDiff(closing.diffCents, dto.shortageKind ?? 'SHORTAGE_PAYBACK'),
              amountCents: Math.abs(closing.diffCents),
            },
          });
        } else {
          await tx.cashClosing.update({ where: { id: closing.id }, data: { status: 'SETTLED' } });
        }
      }
      return { review, disposition };
    });
  }
}
