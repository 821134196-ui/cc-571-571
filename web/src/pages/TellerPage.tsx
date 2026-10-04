import { useEffect, useMemo, useState } from 'react';
import { api, errMsg, getUser } from '../api';
import { Closing } from '../types';
import { CLOSING_STATUS, DISCREPANCY_STATUS, denomLabel, fmtMoney } from '../format';
import AdjustmentsList from '../components/AdjustmentsList';

export default function TellerPage() {
  const user = getUser()!;
  const [closing, setClosing] = useState<Closing | null>(null);
  const [manualQty, setManualQty] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoverAmount, setRecoverAmount] = useState('');
  const [recoverNote, setRecoverNote] = useState('');
  const [tellers, setTellers] = useState<{ id: string; name: string }[]>([]);
  const [handoverTo, setHandoverTo] = useState('');

  const load = async () => {
    const r = await api.post('/closings/start');
    setClosing(r.data);
    const qty: Record<number, string> = {};
    for (const c of r.data.counts) qty[c.denomCents] = String(c.manualQty);
    setManualQty(qty);
  };

  useEffect(() => {
    load().catch((e) => setError(errMsg(e)));
    api.get('/users').then((r) => {
      setTellers(r.data.filter((u: any) => u.role === 'TELLER' && u.id !== user.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<any>, okMsg?: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (okMsg) setNotice(okMsg);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const countsPayload = () =>
    Object.entries(manualQty).map(([d, q]) => ({
      denomCents: Number(d),
      qty: Math.max(0, Number(q) || 0),
    }));

  const live = useMemo(() => {
    if (!closing) return null;
    const manual = countsPayload().reduce((a, c) => a + c.denomCents * c.qty, 0);
    return { manual, diff: manual - closing.expectedCents };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualQty, closing]);

  if (!closing) {
    return <div className="card">{error ? <div className="alert error">{error}</div> : '加载中…'}</div>;
  }

  const editable = closing.status === 'DRAFT' || closing.status === 'RECOUNT_REQUIRED';
  const d = closing.discrepancy;

  const saveCounts = () => run(() => api.put(`/closings/${closing.id}/counts`, { counts: countsPayload() }), '实盘数量已保存');

  const machineCount = () =>
    run(async () => {
      const m = await api.post('/mock/machine-count', { closingId: closing.id });
      await api.put(`/closings/${closing.id}/machine-counts`, { counts: m.data.counts });
    }, '点钞机清点完成');

  const submit = () =>
    run(async () => {
      await api.put(`/closings/${closing.id}/counts`, { counts: countsPayload() });
      const r = await api.post(`/closings/${closing.id}/submit`);
      if (r.data.status === 'RECOUNT_REQUIRED') {
        setError('点钞机与手工盘点不一致：请复盘修正，或联系主管现场确认后复核');
      }
    }, '已提交，等待主管复核');

  const recount = () =>
    run(
      () => api.post(`/closings/${closing.id}/recount`, { counts: countsPayload(), note: '柜员复盘修正' }),
      '复盘修正已留痕并重新提交',
    );

  const recover = () =>
    run(async () => {
      const amountCents = Math.round(Number(recoverAmount) * 100);
      await api.post(`/discrepancies/${d!.id}/recover`, { amountCents, note: recoverNote || undefined });
      setRecoverAmount('');
      setRecoverNote('');
    }, '缴回成功');

  const handover = () =>
    run(async () => {
      await api.put(`/closings/${closing.id}/counts`, { counts: countsPayload() });
      await api.post('/handovers', {
        cashBoxId: closing.cashBoxId,
        toTellerId: handoverTo,
        counts: countsPayload(),
      });
    }, '交接完成，现金箱已移交');

  return (
    <div className="page">
      <div className="page-head">
        <h2>结柜盘点 · {closing.cashBox?.name}（{closing.cashBox?.code}）</h2>
        <div>
          <span className="badge">{closing.businessDay?.date}</span>{' '}
          <span className={`badge status-${closing.status.toLowerCase()}`}>{CLOSING_STATUS[closing.status]}</span>{' '}
          <span className="mono muted">{closing.sessionNo}</span>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}
      {closing.machineMismatch && closing.status === 'RECOUNT_REQUIRED' && (
        <div className="alert warn">
          ⚠ 点钞机合计 {fmtMoney(closing.machineCents)} 与手工实盘 {fmtMoney(closing.manualCents)} 不一致。
          系统不会自动采信任何一方：请复盘修正后重新提交，或由主管现场确认后复核。
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>面额</th>
              <th className="num">应有数量</th>
              <th className="num">实盘数量（手工）</th>
              <th className="num">点钞机数量</th>
              <th className="num">实盘金额</th>
            </tr>
          </thead>
          <tbody>
            {closing.counts.map((c) => (
              <tr
                key={c.denomCents}
                className={c.machineQty != null && c.machineQty !== Number(manualQty[c.denomCents] ?? 0) ? 'row-warn' : ''}
              >
                <td>{denomLabel(c.denomCents)}</td>
                <td className="num">{c.expectedQty}</td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    disabled={!editable || busy}
                    value={manualQty[c.denomCents] ?? '0'}
                    onChange={(e) => setManualQty({ ...manualQty, [c.denomCents]: e.target.value })}
                  />
                </td>
                <td className="num">{c.machineQty ?? '—'}</td>
                <td className="num">{fmtMoney(c.denomCents * (Number(manualQty[c.denomCents]) || 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>合计</td>
              <td className="num">{fmtMoney(closing.expectedCents)}</td>
              <td className="num">{live && fmtMoney(live.manual)}</td>
              <td className="num">{closing.machineCents != null ? fmtMoney(closing.machineCents) : '—'}</td>
              <td className={`num ${live && live.diff > 0 ? 'over' : live && live.diff < 0 ? 'short' : ''}`}>
                {live && (live.diff === 0 ? '账实相符' : live.diff > 0 ? `长款 ${fmtMoney(live.diff)}` : `短款 ${fmtMoney(-live.diff)}`)}
              </td>
            </tr>
          </tfoot>
        </table>

        {editable && (
          <div className="actions">
            <button disabled={busy} onClick={saveCounts}>保存实盘</button>
            <button disabled={busy} onClick={machineCount}>点钞机清点</button>
            {closing.status === 'DRAFT' && (
              <button className="primary" disabled={busy} onClick={submit}>提交结柜</button>
            )}
            {closing.status === 'RECOUNT_REQUIRED' && (
              <button className="primary" disabled={busy} onClick={recount}>复盘修正并重新提交</button>
            )}
            {tellers.length > 0 && (
              <span className="handover">
                <select value={handoverTo} onChange={(e) => setHandoverTo(e.target.value)}>
                  <option value="">选择接班柜员…</option>
                  {tellers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button disabled={busy || !handoverTo} onClick={handover}>跨班交接</button>
              </span>
            )}
          </div>
        )}
      </div>

      {d && (
        <div className="card">
          <h3>
            {d.type === 'OVER' ? '长款' : '短款'} {fmtMoney(d.amountCents)}
            <span className={`badge status-${d.status.toLowerCase()}`}>{DISCREPANCY_STATUS[d.status]}</span>
          </h3>
          <p>
            未了余额：<strong>{fmtMoney(d.outstandingCents)}</strong>
            {d.confirmedCents > 0 && <>　财务已确认：{fmtMoney(d.confirmedCents)}</>}
          </p>
          {d.responsibilityNote && <p className="muted">责任说明：{d.responsibilityNote}</p>}
          {d.type === 'SHORT' && d.outstandingCents > 0 && (
            <div className="actions">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="缴回金额（元）"
                value={recoverAmount}
                onChange={(e) => setRecoverAmount(e.target.value)}
              />
              <input
                type="text"
                placeholder="备注（可选）"
                value={recoverNote}
                onChange={(e) => setRecoverNote(e.target.value)}
              />
              <button className="primary" disabled={busy || !recoverAmount} onClick={recover}>
                办理缴回
              </button>
            </div>
          )}
          {d.receipts && d.receipts.length > 0 && (
            <table className="table">
              <thead><tr><th>财务回执号</th><th className="num">金额</th><th>状态</th><th>时间</th></tr></thead>
              <tbody>
                {d.receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.receiptNo}</td>
                    <td className="num">{fmtMoney(r.amountCents)}</td>
                    <td>{r.status === 'APPLIED' ? '已入账' : '重复回执'}</td>
                    <td className="mono">{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="card">
        <h3>调整记录（各次修正原始记录可展开）</h3>
        <AdjustmentsList adjustments={closing.adjustments} />
      </div>
    </div>
  );
}
