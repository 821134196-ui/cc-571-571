import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertBooksBalanced,
  ledgerEntries,
  line,
  makeServices,
  openDay,
  prisma,
  resetAndSeed,
  TestUsers,
} from './helpers';

const svc = makeServices();
let u: TestUsers;

beforeEach(async () => {
  u = await resetAndSeed();
});

describe('金额核对：面额计算与机器/手工冲突', () => {
  it('按面额计算应有/实盘金额与长短款', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [
        line(10000, 10, 10, 10), // 100元
        line(5000, 4, 3, 3), // 50元：少1张 → 短款50元
      ],
    });
    expect(closing.expectedCents).toBe(120000);
    expect(closing.actualCents).toBe(115000);
    expect(closing.diffCents).toBe(-5000); // 短款 50.00
    expect(closing.countConflict).toBe(false);
    await assertBooksBalanced(closing.id);
  });

  it('机器与手工不一致时提示复核，不自动采信任一方，须修正确认后才能复核', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 10, 10), line(5000, 4, 3, 5)], // 手工115000 vs 机器125000
    });
    expect(closing.countConflict).toBe(true);
    expect(closing.warning).toContain('不一致');
    // 系统保留手工结果但不自动认定：actualCents 仍为手工数，且禁止复核
    expect(closing.actualCents).toBe(115000);
    await expect(
      svc.reviews.review(u.supervisor, { closingId: closing.id, decision: 'APPROVE' }),
    ).rejects.toThrow(/不一致/);

    // 柜员复盘后提交修正记录：确认 50元 实为 3 张（手工正确）
    await svc.adjustments.add(u.teller1, closing.id, {
      type: 'CORRECTION',
      note: '复盘确认手工数量正确',
      lines: [
        { denomCents: 10000, finalQty: 10 },
        { denomCents: 5000, finalQty: 3 },
      ],
    });
    const after = await svc.closings.detail(closing.id);
    expect(after.countConflict).toBe(false);
    expect(after.diffCents).toBe(-5000);
    await assertBooksBalanced(closing.id);

    // 修正后可以复核
    const { disposition } = await svc.reviews.review(u.supervisor, {
      closingId: closing.id,
      decision: 'APPROVE',
    });
    expect(disposition?.kind).toBe('SHORTAGE_PAYBACK');
    expect(disposition?.amountCents).toBe(5000);
    await assertBooksBalanced(closing.id);
  });

  it('修正记录改变数量时同步更新差额并保持账目一致', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 9, 9)], // 短款 100元
    });
    const before = await assertBooksBalanced(closing.id);
    // 复盘发现角落还有 1 张 100元 → 修正为 10 张
    await svc.adjustments.add(u.teller1, closing.id, {
      type: 'CORRECTION',
      lines: [{ denomCents: 10000, finalQty: 10 }],
    });
    const after = await svc.closings.detail(closing.id);
    expect(after.diffCents).toBe(0);
    const afterBal = await assertBooksBalanced(closing.id);
    expect(afterBal.ledgerSum).toBe(before.ledgerSum + 10000); // 调整量已入账
  });
});

describe('复核与处置流程', () => {
  it('长款进入待认领，财务确认后结清，账本净额为0', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 11, 11)], // 长款 100元
    });
    const { disposition } = await svc.reviews.review(u.supervisor, {
      closingId: closing.id,
      decision: 'APPROVE',
    });
    expect(disposition?.kind).toBe('OVERAGE_CLAIM');
    await assertBooksBalanced(closing.id);

    await svc.finance.issueMockReceipt(u.finance, disposition!.id, 'CONFIRM');
    const after = await svc.closings.detail(closing.id);
    expect(after.status).toBe('SETTLED');
    const bal = await assertBooksBalanced(closing.id);
    expect(bal.ledgerSum).toBe(0); // 结清：差额 -10000? 长款+10000 与认领出账 -10000 抵平
  });

  it('短款可选择责任说明，确认后挂账', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 10, 10), line(2000, 5, 4, 4)], // 短款 20元
    });
    const { disposition } = await svc.reviews.review(u.supervisor, {
      closingId: closing.id,
      decision: 'APPROVE',
      shortageKind: 'SHORTAGE_STATEMENT',
    });
    expect(disposition?.kind).toBe('SHORTAGE_STATEMENT');
    await svc.finance.issueMockReceipt(u.finance, disposition!.id, 'CONFIRM');
    const entries = await ledgerEntries(closing.id);
    expect(entries.map((e) => e.kind)).toContain('STATEMENT');
    const bal = await assertBooksBalanced(closing.id);
    expect(bal.ledgerSum).toBe(0);
  });

  it('柜员不能复核本人结柜单', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 10)],
    });
    // 非主管角色被拒绝
    await expect(
      svc.reviews.review(u.teller2, { closingId: closing.id, decision: 'APPROVE' }),
    ).rejects.toThrow(/主管/);
    // 本人复核被拒绝（构造主管名下的结柜单验证自复核守卫）
    const selfClosing = await prisma.cashClosing.create({
      data: {
        businessDayId: closing.businessDayId,
        tellerId: u.supervisor.id,
        shift: 'EVENING',
        expectedCents: 0,
        actualCents: 0,
        diffCents: 0,
      },
    });
    await expect(
      svc.reviews.review(u.supervisor, { closingId: selfClosing.id, decision: 'APPROVE' }),
    ).rejects.toThrow(/本人/);
    // 其他主管可以复核
    await svc.reviews.review(u.supervisor2, { closingId: selfClosing.id, decision: 'APPROVE' });
  });

  it('复核退回后可通过修正记录重新提交', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 8, 8)],
    });
    await svc.reviews.review(u.supervisor, {
      closingId: closing.id,
      decision: 'REJECT',
      comment: '请重新盘点',
    });
    let cur = await svc.closings.detail(closing.id);
    expect(cur.status).toBe('REJECTED');
    // 退回状态下不能再次复核
    await expect(
      svc.reviews.review(u.supervisor, { closingId: closing.id, decision: 'APPROVE' }),
    ).rejects.toThrow(/状态/);
    // 修正后自动回到待复核
    await svc.adjustments.add(u.teller1, closing.id, {
      type: 'CORRECTION',
      lines: [{ denomCents: 10000, finalQty: 10 }],
    });
    cur = await svc.closings.detail(closing.id);
    expect(cur.status).toBe('SUBMITTED');
    expect(cur.diffCents).toBe(0);
    await svc.reviews.review(u.supervisor, { closingId: closing.id, decision: 'APPROVE' });
    cur = await svc.closings.detail(closing.id);
    expect(cur.status).toBe('SETTLED'); // 无差额直接结清
    await assertBooksBalanced(closing.id);
  });
});

describe('财务回执幂等', () => {
  it('重复财务回执不重复确认、不重复冲销', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 9, 9)], // 短款 100元
    });
    const { disposition } = await svc.reviews.review(u.supervisor, {
      closingId: closing.id,
      decision: 'APPROVE',
    });

    // 确认回执 R1
    const r1 = { receiptNo: 'RCPT-001', dispositionId: disposition!.id, action: 'CONFIRM' as const, amountCents: 10000 };
    const first = await svc.finance.submitReceipt(u.finance, r1);
    expect(first.duplicated).toBe(false);
    const entriesAfterConfirm = await ledgerEntries(closing.id);

    // 重复提交同一回执：幂等返回，不产生新账
    const dup = await svc.finance.submitReceipt(u.finance, r1);
    expect(dup.duplicated).toBe(true);
    expect(await ledgerEntries(closing.id)).toHaveLength(entriesAfterConfirm.length);
    let d = await prisma.disposition.findUniqueOrThrow({ where: { id: disposition!.id } });
    expect(d.status).toBe('CONFIRMED');

    // 冲销回执 R2
    const r2 = { receiptNo: 'RCPT-002', dispositionId: disposition!.id, action: 'REVERSAL' as const, amountCents: 10000 };
    await svc.finance.submitReceipt(u.finance, r2);
    d = await prisma.disposition.findUniqueOrThrow({ where: { id: disposition!.id } });
    expect(d.status).toBe('REVERSED');
    const entriesAfterReversal = await ledgerEntries(closing.id);
    expect(entriesAfterReversal.map((e) => e.kind)).toContain('REVERSAL');

    // 重复冲销回执：不得再次冲销
    const dupReversal = await svc.finance.submitReceipt(u.finance, r2);
    expect(dupReversal.duplicated).toBe(true);
    expect(await ledgerEntries(closing.id)).toHaveLength(entriesAfterReversal.length);
    // 冲销后不能再走原回执确认，也不能用新回执确认（状态守卫）
    await expect(
      svc.finance.submitReceipt(u.finance, { receiptNo: 'RCPT-003', dispositionId: disposition!.id, action: 'CONFIRM', amountCents: 10000 }),
    ).rejects.toThrow(/待处理/);
    await assertBooksBalanced(closing.id);
  });

  it('回执金额与处置单不一致时拒绝', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 9, 9)],
    });
    const { disposition } = await svc.reviews.review(u.supervisor, {
      closingId: closing.id,
      decision: 'APPROVE',
    });
    await expect(
      svc.finance.submitReceipt(u.finance, {
        receiptNo: 'RCPT-X',
        dispositionId: disposition!.id,
        action: 'CONFIRM',
        amountCents: 999,
      }),
    ).rejects.toThrow(/金额/);
  });
});

describe('并发结柜与重复结柜', () => {
  it('同一柜员同一班次并发提交：只成功一次，不重复入账', async () => {
    await openDay('2026-10-04');
    const dto = { shift: 'MORNING', lines: [line(10000, 10, 9, 9)] };
    const results = await Promise.allSettled([
      svc.closings.create(u.teller1, dto),
      svc.closings.create(u.teller1, dto),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const dup = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(dup).toHaveLength(1);
    expect((dup[0] as PromiseRejectedResult).reason.message).toMatch(/重复结柜/);
    expect(await prisma.cashClosing.count()).toBe(1);
  });

  it('两人同时结柜：各自成功，复核后各自只记一笔差额账', async () => {
    await openDay('2026-10-04');
    const [c1, c2] = await Promise.all([
      svc.closings.create(u.teller1, { shift: 'MORNING', lines: [line(10000, 10, 11, 11)] }),
      svc.closings.create(u.teller2, { shift: 'MORNING', lines: [line(10000, 20, 19, 19)] }),
    ]);
    expect(await prisma.cashClosing.count()).toBe(2);

    // 并发复核两张单
    await Promise.all([
      svc.reviews.review(u.supervisor, { closingId: c1.id, decision: 'APPROVE' }),
      svc.reviews.review(u.supervisor2, { closingId: c2.id, decision: 'APPROVE' }),
    ]);
    const e1 = await ledgerEntries(c1.id);
    const e2 = await ledgerEntries(c2.id);
    expect(e1.filter((e) => e.kind === 'CLOSING_DIFF')).toHaveLength(1);
    expect(e2.filter((e) => e.kind === 'CLOSING_DIFF')).toHaveLength(1);
    expect(e1[0].amountCents).toBe(10000);
    expect(e2[0].amountCents).toBe(-10000);
    await assertBooksBalanced(c1.id);
    await assertBooksBalanced(c2.id);
  });

  it('并发复核同一结柜单：只产生一条复核结论和一笔差额账', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 11, 11)],
    });
    const results = await Promise.allSettled([
      svc.reviews.review(u.supervisor, { closingId: closing.id, decision: 'APPROVE' }),
      svc.reviews.review(u.supervisor2, { closingId: closing.id, decision: 'APPROVE' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.review.count({ where: { closingId: closing.id } })).toBe(1);
    const entries = await ledgerEntries(closing.id);
    expect(entries.filter((e) => e.kind === 'CLOSING_DIFF')).toHaveLength(1);
    expect(await prisma.disposition.count({ where: { closingId: closing.id } })).toBe(1);
    await assertBooksBalanced(closing.id);
  });

  it('并发提交同一财务回执：只处理一次', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 9, 9)],
    });
    const { disposition } = await svc.reviews.review(u.supervisor, {
      closingId: closing.id,
      decision: 'APPROVE',
    });
    const receipt = { receiptNo: 'RCPT-CONC', dispositionId: disposition!.id, action: 'CONFIRM' as const, amountCents: 10000 };
    await Promise.allSettled([
      svc.finance.submitReceipt(u.finance, receipt),
      svc.finance.submitReceipt(u.finance, receipt),
    ]);
    expect(await prisma.financeReceipt.count({ where: { receiptNo: 'RCPT-CONC' } })).toBe(1);
    const entries = await ledgerEntries(closing.id);
    expect(entries.filter((e) => e.kind === 'PAYBACK')).toHaveLength(1);
    await assertBooksBalanced(closing.id);
  });
});

describe('跨日差额归属', () => {
  it('事后找到现金记在原营业日，跨日归属保留，调整前后账目一致', async () => {
    const day1 = await openDay('2026-10-04');
    // 第一天：短款 50元，复核缴回，财务确认，关闭营业日
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 9, 9)],
    });
    const { disposition } = await svc.reviews.review(u.supervisor, {
      closingId: closing.id,
      decision: 'APPROVE',
    });
    await svc.finance.issueMockReceipt(u.finance, disposition!.id, 'CONFIRM');
    await svc.days.closeCurrent(u.finance);
    const day2 = await svc.days.openNext(u.finance, '2026-10-05');
    expect(day2.status).toBe('OPEN');

    // 第二天：在抽屉缝隙找到丢失的 50元 → FOUND_CASH 调整
    const { adjustment, newDisposition } = await svc.adjustments.add(u.teller1, closing.id, {
      type: 'FOUND_CASH',
      note: '抽屉缝隙找到丢失现金',
      deltaCents: 5000,
    });
    // 归属保留：调整记在原营业日，录入日是第二天
    expect(adjustment.originBusinessDayId).toBe(day1.id);
    expect(adjustment.createdBusinessDayId).toBe(day2.id);
    // 找到的现金形成新的长款待认领
    expect(newDisposition?.kind).toBe('OVERAGE_CLAIM');
    expect(newDisposition?.amountCents).toBe(5000);
    await assertBooksBalanced(closing.id);

    // 账本归属：调整账记在第一天的报告里，第二天不受影响
    const report1 = await svc.days.report(day1.id);
    const report2 = await svc.days.report(day2.id);
    expect(report1.ledger.byKind['ADJUSTMENT']).toBe(5000);
    expect(report1.totals.outstandingCents).toBe(5000);
    expect(report2.ledger.total).toBe(0);
    expect(report2.totals.count).toBe(0);

    // 财务确认新长款后，第一天账目全部结清
    await svc.finance.issueMockReceipt(u.finance, newDisposition!.id, 'CONFIRM');
    const bal = await assertBooksBalanced(closing.id);
    expect(bal.ledgerSum).toBe(0);
    const report1After = await svc.days.report(day1.id);
    expect(report1After.totals.outstandingCents).toBe(0);
    expect(report1After.ledger.total).toBe(0);
  });

  it('跨班交接差异通过调整记录处理', async () => {
    await openDay('2026-10-04');
    const morning = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 10, 10)],
    });
    await svc.reviews.review(u.supervisor, { closingId: morning.id, decision: 'APPROVE' });
    // 晚班接班时发现少 20元 → 主管登记交接调整，记到早班结柜单上
    const { adjustment, newDisposition } = await svc.adjustments.add(u.supervisor, morning.id, {
      type: 'HANDOVER',
      note: '晚班交接盘点少 20元',
      deltaCents: -2000,
    });
    expect(adjustment.type).toBe('HANDOVER');
    expect(newDisposition?.kind).toBe('SHORTAGE_PAYBACK');
    expect(newDisposition?.amountCents).toBe(2000);
    // 柜员不能调整他人结柜单
    await expect(
      svc.adjustments.add(u.teller2, morning.id, { type: 'HANDOVER', deltaCents: -100 }),
    ).rejects.toThrow(/本人/);
    // 结柜柜员本人可以补充登记
    await svc.adjustments.add(u.teller1, morning.id, { type: 'HANDOVER', deltaCents: -100 });
    await assertBooksBalanced(morning.id);
  });
});

describe('营业日关闭', () => {
  it('存在未处理事项时禁止关账，全部处理完才能关闭', async () => {
    await openDay('2026-10-04');
    const closing = await svc.closings.create(u.teller1, {
      shift: 'MORNING',
      lines: [line(10000, 10, 9, 9)],
    });
    // 未复核 → 不能关账
    await expect(svc.days.closeCurrent(u.finance)).rejects.toThrow(/未复核 1 笔/);
    const { disposition } = await svc.reviews.review(u.supervisor, {
      closingId: closing.id,
      decision: 'APPROVE',
    });
    // 待财务确认 → 不能关账
    await expect(svc.days.closeCurrent(u.finance)).rejects.toThrow(/待财务确认 1 笔/);
    await svc.finance.issueMockReceipt(u.finance, disposition!.id, 'CONFIRM');
    // 全部处理完 → 关账成功
    const closed = await svc.days.closeCurrent(u.finance);
    expect(closed.status).toBe('CLOSED');
    // 关账后不能再开新结柜单
    await expect(
      svc.closings.create(u.teller1, { shift: 'EVENING', lines: [line(10000, 1, 1)] }),
    ).rejects.toThrow(/营业日/);
    // 开启下一天
    const next = await svc.days.openNext(u.finance, '2026-10-05');
    expect(next.date).toBe('2026-10-05');
  });
});
