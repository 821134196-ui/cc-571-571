// 验证一：金额核对 —— 面额盘点 → 差额计算 → 复核入账 → 认领/缴回/回执，全程账目一致
import './test-env';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma.service';
import { createTestApp, withQty, TestContext } from './helpers';

describe('金额核对（盘点差额与台账一致性）', () => {
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

  const reconcile = async () => {
    const res = await ctx.agent('finance').get('/api/ledger/reconcile').expect(200);
    return res.body;
  };

  it('机点与手点不一致时提示复核，不自动采信任何一方', async () => {
    const teller = ctx.agent('teller1');
    const supervisor = ctx.agent('supervisor');

    // 开始结柜：应有合计 = 1,177,000 分（11770 元）
    const started = await teller.post('/api/closings/start').expect(201);
    const closingId = started.body.id;
    expect(started.body.expectedCents).toBe(1177000);

    // 手工实盘：100元多 1 张（长款 100 元）
    const manual = withQty(started.body.counts, 10000, 51);
    await teller.put(`/api/closings/${closingId}/counts`).send({ counts: manual }).expect(200);

    // 点钞机清点结果与手工不一致（机点 50 张 vs 手点 51 张）
    const machineCounts = withQty(started.body.counts, 10000, 50);
    const machine = await teller
      .post('/api/mock/machine-count')
      .send({ closingId, counts: machineCounts })
      .expect(201);
    await teller
      .put(`/api/closings/${closingId}/machine-counts`)
      .send({ counts: machine.body.counts })
      .expect(200);

    // 提交 → 不自动认定任何一方正确，进入待复盘
    const submitted = await teller.post(`/api/closings/${closingId}/submit`).expect(201);
    expect(submitted.body.status).toBe('RECOUNT_REQUIRED');
    expect(submitted.body.machineMismatch).toBe(true);

    // 主管不能直接复核不一致的单子（须显式确认并注明原因）
    await supervisor.post(`/api/closings/${closingId}/review`).send({}).expect(400);
    await supervisor
      .post(`/api/closings/${closingId}/review`)
      .send({ confirmManual: true })
      .expect(400);

    // 主管核实后确认以手工盘点为准
    const reviewed = await supervisor
      .post(`/api/closings/${closingId}/review`)
      .send({ confirmManual: true, note: '现场复核确认手点 51 张，点钞机漏记 1 张' })
      .expect(201);
    expect(reviewed.body.status).toBe('REVIEWED');
    expect(reviewed.body.diffCents).toBe(10000);
    expect(reviewed.body.discrepancy.type).toBe('OVER');
    expect(reviewed.body.discrepancy.amountCents).toBe(10000);
    expect(reviewed.body.discrepancy.status).toBe('PENDING_CLAIM');

    // 台账：现金箱 +100 元，长款待认领 -100 元，全局配平
    const rec = await reconcile();
    expect(rec.balanced).toBe(true);
    expect(rec.accounts['CASH:BOX001']).toBe(10000);
    expect(rec.accounts['OVER_SUSPENSE']).toBe(-10000);
    expect(rec.checks.overSuspenseMatchesOpenClaims).toBe(true);
  });

  it('长款分次认领，余额与台账同步减少', async () => {
    const supervisor = ctx.agent('supervisor');
    const d = await prisma.discrepancy.findFirstOrThrow({ where: { type: 'OVER' } });

    // 部分认领 40 元
    const partial = await supervisor
      .post(`/api/discrepancies/${d.id}/claim`)
      .send({ amountCents: 4000, claimant: '客户甲' })
      .expect(201);
    expect(partial.body.outstandingCents).toBe(6000);
    expect(partial.body.status).toBe('PENDING_CLAIM');

    // 超额认领被拒绝
    await supervisor
      .post(`/api/discrepancies/${d.id}/claim`)
      .send({ amountCents: 999999, claimant: '客户乙' })
      .expect(400);

    // 剩余 60 元认领完毕
    const done = await supervisor
      .post(`/api/discrepancies/${d.id}/claim`)
      .send({ amountCents: 6000, claimant: '客户乙' })
      .expect(201);
    expect(done.body.outstandingCents).toBe(0);
    expect(done.body.status).toBe('CLAIMED');

    const rec = await reconcile();
    expect(rec.balanced).toBe(true);
    expect(rec.accounts['OVER_SUSPENSE'] ?? 0).toBe(0);
    expect(rec.accounts['CASH:BOX001']).toBe(0);
    expect(rec.checks.overSuspenseMatchesOpenClaims).toBe(true);

    // 调整记录链完整：两次认领各一条，前后余额快照衔接
    const detail = await supervisor.get(`/api/discrepancies/${d.id}`).expect(200);
    const claims = detail.body.adjustments.filter((a: any) => a.type === 'CLAIM_PAYOUT');
    expect(claims).toHaveLength(2);
    expect(claims[0].outstandingBefore).toBe(10000);
    expect(claims[0].outstandingAfter).toBe(6000);
    expect(claims[1].outstandingBefore).toBe(6000);
    expect(claims[1].outstandingAfter).toBe(0);
  });

  it('短款缴回 + 财务回执，重复回执不再次冲销', async () => {
    const teller = ctx.agent('teller2');
    const supervisor = ctx.agent('supervisor');
    const finance = ctx.agent('finance');

    // 二号箱应有 664,000 分；实盘少 2 张 10 元（短款 20 元）
    const started = await teller.post('/api/closings/start').expect(201);
    const closingId = started.body.id;
    expect(started.body.expectedCents).toBe(664000);
    const manual = withQty(started.body.counts, 1000, 98);
    await teller.put(`/api/closings/${closingId}/counts`).send({ counts: manual }).expect(200);
    const submitted = await teller.post(`/api/closings/${closingId}/submit`).expect(201);
    expect(submitted.body.status).toBe('SUBMITTED');
    expect(submitted.body.diffCents).toBe(-2000);

    const reviewed = await supervisor.post(`/api/closings/${closingId}/review`).send({}).expect(201);
    const discrepancyId = reviewed.body.discrepancy.id;
    expect(reviewed.body.discrepancy.type).toBe('SHORT');
    expect(reviewed.body.discrepancy.status).toBe('PENDING_RECOVERY');

    let rec = await reconcile();
    expect(rec.accounts['SHORT_RECEIVABLE']).toBe(2000);
    expect(rec.checks.shortReceivableMatchesOpenRecoveries).toBe(true);

    // 柜员缴回 20 元
    const recovered = await teller
      .post(`/api/discrepancies/${discrepancyId}/recover`)
      .send({ amountCents: 2000, note: '柜员补缴' })
      .expect(201);
    expect(recovered.body.status).toBe('RECOVERED');
    expect(recovered.body.outstandingCents).toBe(0);

    // 财务回执确认收款 20 元
    const receipt = await finance
      .post('/api/finance/receipts')
      .send({ receiptNo: 'FR-TEST-001', discrepancyId, amountCents: 2000 })
      .expect(201);
    expect(receipt.body.duplicate).toBe(false);

    rec = await reconcile();
    expect(rec.accounts['SHORT_RECEIVABLE']).toBe(0);
    expect(rec.accounts['FINANCE_VAULT']).toBe(2000);
    expect(rec.accounts['CASH:BOX002']).toBe(-2000);
    expect(rec.balanced).toBe(true);

    // 同一回执号再次入账 → 幂等返回，不再次冲销
    const dup = await finance
      .post('/api/finance/receipts')
      .send({ receiptNo: 'FR-TEST-001', discrepancyId, amountCents: 2000 })
      .expect(201);
    expect(dup.body.duplicate).toBe(true);

    const receiptCount = await prisma.financeReceipt.count({ where: { receiptNo: 'FR-TEST-001' } });
    expect(receiptCount).toBe(1);
    rec = await reconcile();
    expect(rec.accounts['FINANCE_VAULT']).toBe(2000); // 金库只增加了一次
    expect(rec.balanced).toBe(true);
  });
});
