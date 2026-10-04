// 验证三：并发结柜 —— 两人同时结柜不重复入账；重复回执不重复冲销；柜员不能复核自己
import './test-env';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma.service';
import { createTestApp, withQty, TestContext } from './helpers';

describe('并发结柜与幂等（两人同时结柜，账目不重复入账）', () => {
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

  it('同一现金箱并发开启结柜只产生一张单', async () => {
    const teller = ctx.agent('teller1');
    const results = await Promise.all([
      teller.post('/api/closings/start'),
      teller.post('/api/closings/start'),
      teller.post('/api/closings/start'),
    ]);
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1); // 幂等：拿到的是同一张单
    const count = await prisma.closingSession.count();
    expect(count).toBe(1);
  });

  it('两人同时结柜 + 并发复核：各入账一次，台账配平', async () => {
    const teller1 = ctx.agent('teller1');
    const teller2 = ctx.agent('teller2');
    const supervisor = ctx.agent('supervisor');

    // 两柜员同时开启结柜
    const [s1, s2] = await Promise.all([
      teller1.post('/api/closings/start'),
      teller2.post('/api/closings/start'),
    ]);
    expect(s1.body.id).not.toBe(s2.body.id);
    const c1 = s1.body.id;
    const c2 = s2.body.id;

    // 同时登记实盘：1号箱长款 100 元，2号箱短款 20 元
    await Promise.all([
      teller1.put(`/api/closings/${c1}/counts`).send({ counts: withQty(s1.body.counts, 10000, 51) }),
      teller2.put(`/api/closings/${c2}/counts`).send({ counts: withQty(s2.body.counts, 1000, 98) }),
    ]);

    // 同时提交
    const [sub1, sub2] = await Promise.all([
      teller1.post(`/api/closings/${c1}/submit`),
      teller2.post(`/api/closings/${c2}/submit`),
    ]);
    expect(sub1.body.status).toBe('SUBMITTED');
    expect(sub2.body.status).toBe('SUBMITTED');

    // 两名主管（同一主管账号并发两次）同时复核同一结柜单 → 只有一人成功
    const reviews = await Promise.all([
      supervisor.post(`/api/closings/${c1}/review`).send({}),
      supervisor.post(`/api/closings/${c1}/review`).send({}),
    ]);
    const statuses = reviews.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);

    // 长款只入账一次
    const overCount = await prisma.discrepancy.count({ where: { closingId: c1 } });
    expect(overCount).toBe(1);
    const reviewEntries = await prisma.ledgerEntry.findMany({
      where: { refType: 'CLOSING_REVIEW' },
    });
    expect(reviewEntries).toHaveLength(2); // 一借一贷，恰好一批
    expect(reviewEntries.reduce((a, e) => a + e.amountCents, 0)).toBe(0);

    // 复核第二张单（短款）
    await supervisor.post(`/api/closings/${c2}/review`).send({}).expect(201);

    let rec = (await ctx.agent('finance').get('/api/ledger/reconcile').expect(200)).body;
    expect(rec.balanced).toBe(true);
    expect(rec.accounts['OVER_SUSPENSE']).toBe(-10000);
    expect(rec.accounts['SHORT_RECEIVABLE']).toBe(2000);

    // 柜员缴回短款后，财务同号回执并发到达 → 只冲销一次
    const short = await prisma.discrepancy.findFirstOrThrow({ where: { type: 'SHORT' } });
    await teller2
      .post(`/api/discrepancies/${short.id}/recover`)
      .send({ amountCents: 2000 })
      .expect(201);

    const finance = ctx.agent('finance');
    const receipts = await Promise.all([
      finance
        .post('/api/finance/receipts')
        .send({ receiptNo: 'FR-DUP-001', discrepancyId: short.id, amountCents: 2000 }),
      finance
        .post('/api/finance/receipts')
        .send({ receiptNo: 'FR-DUP-001', discrepancyId: short.id, amountCents: 2000 }),
    ]);
    const applied = receipts.filter((r) => r.body.duplicate === false);
    const duplicated = receipts.filter((r) => r.body.duplicate === true);
    expect(applied).toHaveLength(1);
    expect(duplicated).toHaveLength(1);

    const receiptRows = await prisma.financeReceipt.count({ where: { receiptNo: 'FR-DUP-001' } });
    expect(receiptRows).toBe(1);

    rec = (await finance.get('/api/ledger/reconcile').expect(200)).body;
    expect(rec.accounts['FINANCE_VAULT']).toBe(2000); // 只入账一次
    expect(rec.balanced).toBe(true);
    expect(rec.checks.overSuspenseMatchesOpenClaims).toBe(true);
    expect(rec.checks.shortReceivableMatchesOpenRecoveries).toBe(true);
  });

  it('柜员不能复核自己的结柜单', async () => {
    // 给主管也配一个现金箱（主管兼岗场景）
    const supervisorUser = ctx.users['supervisor'];
    const box = await prisma.cashBox.create({
      data: {
        code: 'BOX003',
        name: '三号现金箱',
        tellerId: supervisorUser.id,
        denoms: { create: [{ denomCents: 10000, qty: 10 }] },
      },
    });
    const supervisor = ctx.agent('supervisor');
    const started = await supervisor.post('/api/closings/start').expect(201);
    expect(started.body.cashBoxId).toBe(box.id);
    await supervisor
      .put(`/api/closings/${started.body.id}/counts`)
      .send({ counts: [{ denomCents: 10000, qty: 10 }] })
      .expect(200);
    await supervisor.post(`/api/closings/${started.body.id}/submit`).expect(201);

    // 本人复核本人 → 403
    const res = await supervisor.post(`/api/closings/${started.body.id}/review`).send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('不能复核本人');

    // 复核权仍在其他主管手中（此处无第二主管，验证单据仍处于待复核即可）
    const closing = await prisma.closingSession.findUniqueOrThrow({
      where: { id: started.body.id },
    });
    expect(closing.status).toBe('SUBMITTED');
  });
});
