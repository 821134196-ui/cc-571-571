// 验证二：跨日差额 —— 短款当日挂账，次日找到现金，调整落在次日而归属保留在原营业日
import './test-env';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma.service';
import { createTestApp, withQty, TestContext } from './helpers';

describe('跨日差额（归属保留 + 调整前后账目一致）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await app.close();
  });

  it('未确认事项存在时不能关闭营业日；确认后可关闭并结转', async () => {
    const teller = ctx.agent('teller1');
    const supervisor = ctx.agent('supervisor');
    const finance = ctx.agent('finance');

    // 第一日：短款 50 元（50元面额少 1 张）
    const started = await teller.post('/api/closings/start').expect(201);
    const closingId = started.body.id;
    const day1 = started.body.businessDay;
    const manual = withQty(started.body.counts, 5000, 39);
    await teller.put(`/api/closings/${closingId}/counts`).send({ counts: manual }).expect(200);
    await teller.post(`/api/closings/${closingId}/submit`).expect(201);
    const reviewed = await supervisor.post(`/api/closings/${closingId}/review`).send({}).expect(201);
    const discrepancyId = reviewed.body.discrepancy.id;
    expect(reviewed.body.discrepancy.type).toBe('SHORT');
    expect(reviewed.body.discrepancy.amountCents).toBe(5000);

    // 未复核单/未确认事项 → 拒绝日结
    await finance.post(`/api/business-days/${day1.id}/close`).expect(409);

    // 主管填写责任说明（不产生现金流动，余额仍挂账）
    const filed = await supervisor
      .post(`/api/discrepancies/${discrepancyId}/responsibility`)
      .send({ note: '监控核实为点钞机卡钞，柜员无主观责任' })
      .expect(201);
    expect(filed.body.status).toBe('RESPONSIBILITY_FILED');
    expect(filed.body.outstandingCents).toBe(5000);

    // 财务尚未确认 → 仍拒绝日结
    await finance.post(`/api/business-days/${day1.id}/close`).expect(409);

    // 财务确认该未处理事项 → 允许日结，事项挂账结转
    await finance.post(`/api/discrepancies/${discrepancyId}/ack`).expect(201);
    const closed = await finance.post(`/api/business-days/${day1.id}/close`).expect(201);
    expect(closed.body.closed).toBe(true);
    expect(closed.body.carriedDiscrepancies).toHaveLength(1);
    expect(closed.body.carriedDiscrepancies[0].attributionDate).toBe(day1.date);

    // 开立第二日
    const day2 = await finance.post('/api/business-days/open-next').expect(201);
    expect(day2.body.status).toBe('OPEN');
    expect(day2.body.date > day1.date).toBe(true);

    // 次日在点钞机卡钞槽找到 50 元 → 事后找到现金
    const found = await supervisor
      .post(`/api/discrepancies/${discrepancyId}/found-cash`)
      .send({ amountCents: 5000, note: '拆检点钞机在卡钞槽找到 50 元' })
      .expect(201);
    expect(found.body.status).toBe('RECOVERED');
    expect(found.body.outstandingCents).toBe(0);

    // 归属日仍是第一日（跨日保留归属）
    expect(found.body.attributionDay.date).toBe(day1.date);

    // 调整记录：责任说明落在第一日，找现落在第二日；前后余额快照衔接
    const detail = await supervisor.get(`/api/discrepancies/${discrepancyId}`).expect(200);
    const adjs = detail.body.adjustments;
    const respAdj = adjs.find((a: any) => a.type === 'RESPONSIBILITY_NOTE');
    const foundAdj = adjs.find((a: any) => a.type === 'CASH_FOUND');
    expect(respAdj.postedDayId).toBe(day1.id);
    expect(foundAdj.postedDayId).toBe(day2.body.id);
    expect(foundAdj.outstandingBefore).toBe(5000);
    expect(foundAdj.outstandingAfter).toBe(0);

    // 原结柜单与盘点明细保持原样（原问题可追溯）
    const closing = await teller.get(`/api/closings/${closingId}`).expect(200);
    expect(closing.body.status).toBe('REVIEWED');
    const denom50 = closing.body.counts.find((c: any) => c.denomCents === 5000);
    expect(denom50.expectedQty).toBe(40);
    expect(denom50.manualQty).toBe(39);

    // 全程台账配平：短款应收已清零，找回的现金在箱内
    const rec = (await finance.get('/api/ledger/reconcile').expect(200)).body;
    expect(rec.balanced).toBe(true);
    expect(rec.accounts['SHORT_RECEIVABLE'] ?? 0).toBe(0);
    expect(rec.accounts['CASH:BOX001']).toBe(0); // -5000(短款) +5000(找回)
    expect(rec.checks.shortReceivableMatchesOpenRecoveries).toBe(true);

    // 第一日已关闭，其账务不再变动
    const day1After = await prisma.businessDay.findUniqueOrThrow({ where: { id: day1.id } });
    expect(day1After.status).toBe('CLOSED');
  });
});
