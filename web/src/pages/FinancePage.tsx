import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import { BusinessDay, Discrepancy, FinanceReceipt, ReconcileResult } from '../types';
import { DISCREPANCY_STATUS, fmtMoney } from '../format';

export default function FinancePage() {
  const [day, setDay] = useState<BusinessDay | null>(null);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [receipts, setReceipts] = useState<FinanceReceipt[]>([]);
  const [reconcile, setReconcile] = useState<ReconcileResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [receiptNo, setReceiptNo] = useState<Record<string, string>>({});

  const load = async () => {
    const [d, discs, rcpts, rec] = await Promise.all([
      api.get('/business-days/current'),
      api.get('/discrepancies'),
      api.get('/finance/receipts'),
      api.get('/ledger/reconcile'),
    ]);
    setDay(d.data);
    setDiscrepancies(discs.data);
    setReceipts(rcpts.data);
    setReconcile(rec.data);
  };

  useEffect(() => {
    load().catch((e) => setError(errMsg(e)));
  }, []);

  const run = async (fn: () => Promise<any>, okMsg?: string) => {
    setError('');
    setNotice('');
    try {
      const r = await fn();
      if (okMsg) setNotice(okMsg);
      await load();
      return r;
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const closeDay = () =>
    run(async () => {
      const r = await api.post(`/business-days/${day!.id}/close`);
      const carried = r.data.carriedDiscrepancies;
      setNotice(
        carried.length > 0
          ? `营业日 ${r.data.date} 已关闭，${carried.length} 笔未了事项挂账结转（保留原归属日）`
          : `营业日 ${r.data.date} 已关闭，无未了事项`,
      );
    });

  const openNext = () => run(() => api.post('/business-days/open-next'), '下一营业日已开立');

  const ack = (d: Discrepancy) =>
    run(() => api.post(`/discrepancies/${d.id}/ack`), '已确认该未处理事项');

  const sendReceipt = (d: Discrepancy) =>
    run(async () => {
      const unconfirmed = d.amountCents - d.outstandingCents - d.confirmedCents;
      const r = await api.post('/mock/finance/send-receipt', {
        receiptNo: receiptNo[d.id] || undefined,
        discrepancyId: d.id,
        amountCents: unconfirmed,
      });
      setNotice(
        r.data.duplicate
          ? `回执 ${r.data.receipt.receiptNo} 为重复回执，未再次冲销`
          : `回执 ${r.data.receipt.receiptNo} 已入账`,
      );
    });

  const unresolved = discrepancies.filter((d) => d.outstandingCents > 0);
  const needReceipt = discrepancies.filter(
    (d) => d.type === 'SHORT' && d.amountCents - d.outstandingCents - d.confirmedCents > 0,
  );

  return (
    <div className="page">
      <div className="page-head">
        <h2>财务确认与日结</h2>
        {day && (
          <div>
            <span className="badge">{day.date}</span>{' '}
            <span className={`badge status-${day.status.toLowerCase()}`}>
              {day.status === 'OPEN' ? '营业中' : '已关闭'}
            </span>
          </div>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <div className="card">
        <h3>未处理事项（{unresolved.length}）—— 全部确认后方可关闭营业日</h3>
        {unresolved.length === 0 && <p className="muted">无未了结事项</p>}
        {unresolved.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>类型</th><th className="num">金额</th><th className="num">未了余额</th><th>状态</th><th>归属营业日</th><th>财务确认</th></tr>
            </thead>
            <tbody>
              {unresolved.map((d) => (
                <tr key={d.id}>
                  <td>{d.type === 'OVER' ? '长款' : '短款'}</td>
                  <td className="num">{fmtMoney(d.amountCents)}</td>
                  <td className="num">{fmtMoney(d.outstandingCents)}</td>
                  <td><span className={`badge status-${d.status.toLowerCase()}`}>{DISCREPANCY_STATUS[d.status]}</span></td>
                  <td className="mono">{d.attributionDay?.date}</td>
                  <td>
                    {d.financeAckedAt ? (
                      <span className="muted">已确认 {new Date(d.financeAckedAt).toLocaleString('zh-CN')}</span>
                    ) : (
                      <button className="link" onClick={() => ack(d)}>确认挂账</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="actions">
          {day?.status === 'OPEN' && (
            <button className="primary" onClick={closeDay}>关闭营业日</button>
          )}
          {day?.status === 'CLOSED' && (
            <button className="primary" onClick={openNext}>开立下一营业日</button>
          )}
        </div>
      </div>

      <div className="card">
        <h3>短款缴回回执（模拟财务系统）</h3>
        {needReceipt.length === 0 && <p className="muted">暂无待确认的缴回款</p>}
        {needReceipt.map((d) => (
          <div key={d.id} className="actions">
            <span>
              短款 {fmtMoney(d.amountCents)}（待确认 {fmtMoney(d.amountCents - d.outstandingCents - d.confirmedCents)}）
            </span>
            <input
              placeholder="回执号（留空自动生成；重复填同号可验证幂等）"
              value={receiptNo[d.id] ?? ''}
              onChange={(e) => setReceiptNo({ ...receiptNo, [d.id]: e.target.value })}
            />
            <button onClick={() => sendReceipt(d)}>发送财务回执</button>
          </div>
        ))}
        {receipts.length > 0 && (
          <table className="table">
            <thead><tr><th>回执号</th><th className="num">金额</th><th>状态</th><th>时间</th></tr></thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.receiptNo}</td>
                  <td className="num">{fmtMoney(r.amountCents)}</td>
                  <td>{r.status === 'APPLIED' ? '已入账' : '重复回执（未冲销）'}</td>
                  <td className="mono">{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {reconcile && (
        <div className="card">
          <h3>台账对账</h3>
          <table className="table">
            <thead><tr><th>账户</th><th className="num">余额</th></tr></thead>
            <tbody>
              {Object.entries(reconcile.accounts).map(([acc, amt]) => (
                <tr key={acc}>
                  <td className="mono">{acc}</td>
                  <td className="num">{fmtMoney(amt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            全局配平：{reconcile.balanced ? <span className="ok-text">✓ 平衡</span> : <span className="short">✗ 不平衡</span>}
            　长款待认领核对：{reconcile.checks.overSuspenseMatchesOpenClaims ? '✓' : '✗'}
            　短款应收核对：{reconcile.checks.shortReceivableMatchesOpenRecoveries ? '✓' : '✗'}
          </p>
        </div>
      )}
    </div>
  );
}
