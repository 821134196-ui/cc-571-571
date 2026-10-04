import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import { Closing, Discrepancy } from '../types';
import { CLOSING_STATUS, DISCREPANCY_STATUS, denomLabel, fmtMoney } from '../format';
import AdjustmentsList from '../components/AdjustmentsList';

export default function SupervisorPage() {
  const [pending, setPending] = useState<Closing[]>([]);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [expanded, setExpanded] = useState<Record<string, Closing>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<Discrepancy | null>(null);

  const load = async () => {
    const [closings, discs] = await Promise.all([
      api.get('/closings'),
      api.get('/discrepancies'),
    ]);
    setPending(closings.data.filter((c: Closing) => ['SUBMITTED', 'RECOUNT_REQUIRED'].includes(c.status)));
    setDiscrepancies(discs.data);
  };

  useEffect(() => {
    load().catch((e) => setError(errMsg(e)));
  }, []);

  const run = async (fn: () => Promise<any>, okMsg: string) => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(okMsg);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const toggleExpand = async (id: string) => {
    if (expanded[id]) {
      const next = { ...expanded };
      delete next[id];
      setExpanded(next);
    } else {
      const r = await api.get(`/closings/${id}`);
      setExpanded({ ...expanded, [id]: r.data });
    }
  };

  const review = (c: Closing, confirmManual: boolean) =>
    run(
      () => api.post(`/closings/${c.id}/review`, { confirmManual, note: note[c.id] || undefined }),
      `结柜单 ${c.sessionNo} 复核完成`,
    );

  const claim = (d: Discrepancy) => {
    const claimant = window.prompt('认领人姓名/账号：');
    if (!claimant) return;
    const yuan = window.prompt(`认领金额（元），未了余额 ${fmtMoney(d.outstandingCents)}：`);
    if (!yuan) return;
    return run(
      () => api.post(`/discrepancies/${d.id}/claim`, { amountCents: Math.round(Number(yuan) * 100), claimant }),
      '认领付出已入账',
    );
  };

  const responsibility = (d: Discrepancy) => {
    const text = window.prompt('责任说明：');
    if (!text) return;
    return run(() => api.post(`/discrepancies/${d.id}/responsibility`, { note: text }), '责任说明已登记');
  };

  const foundCash = (d: Discrepancy) => {
    const yuan = window.prompt(`找到现金金额（元），未了余额 ${fmtMoney(d.outstandingCents)}：`);
    if (!yuan) return;
    const text = window.prompt('找到位置/经过（必填）：');
    if (!text) return;
    return run(
      () => api.post(`/discrepancies/${d.id}/found-cash`, { amountCents: Math.round(Number(yuan) * 100), note: text }),
      '找回现金已入账（归属原营业日）',
    );
  };

  const openDetail = async (d: Discrepancy) => {
    const r = await api.get(`/discrepancies/${d.id}`);
    setDetail(r.data);
  };

  return (
    <div className="page">
      <h2>主管复核</h2>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <div className="card">
        <h3>待复核结柜单（{pending.length}）</h3>
        {pending.length === 0 && <p className="muted">暂无待复核的结柜单</p>}
        {pending.map((c) => (
          <div key={c.id} className="review-item">
            <div className="review-head">
              <span className="mono">{c.sessionNo}</span>
              <span>{c.cashBox?.name}</span>
              <span className={`badge status-${c.status.toLowerCase()}`}>{CLOSING_STATUS[c.status]}</span>
              <span className={c.diffCents > 0 ? 'over' : c.diffCents < 0 ? 'short' : ''}>
                {c.diffCents === 0 ? '账实相符' : c.diffCents > 0 ? `长款 ${fmtMoney(c.diffCents)}` : `短款 ${fmtMoney(-c.diffCents)}`}
              </span>
              {c.machineMismatch && <span className="badge warn-badge">机点/手点不一致</span>}
              <button className="link" onClick={() => toggleExpand(c.id)}>
                {expanded[c.id] ? '收起' : '明细'}
              </button>
            </div>
            {expanded[c.id] && (
              <table className="mini-table">
                <thead>
                  <tr><th>面额</th><th>应有</th><th>手点</th><th>机点</th></tr>
                </thead>
                <tbody>
                  {expanded[c.id].counts.map((dc) => (
                    <tr key={dc.denomCents} className={dc.machineQty != null && dc.machineQty !== dc.manualQty ? 'changed' : ''}>
                      <td>{denomLabel(dc.denomCents)}</td>
                      <td>{dc.expectedQty}</td>
                      <td>{dc.manualQty}</td>
                      <td>{dc.machineQty ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="actions">
              <input
                placeholder="复核说明（机点/手点不一致时必填）"
                value={note[c.id] ?? ''}
                onChange={(e) => setNote({ ...note, [c.id]: e.target.value })}
              />
              {c.status === 'SUBMITTED' && (
                <button className="primary" onClick={() => review(c, false)}>复核通过</button>
              )}
              {c.status === 'RECOUNT_REQUIRED' && (
                <button className="primary" onClick={() => review(c, true)}>
                  确认以手工盘点为准并复核
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>长短款事项（{discrepancies.length}）</h3>
        {discrepancies.length === 0 && <p className="muted">暂无长短款记录</p>}
        {discrepancies.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>类型</th><th className="num">金额</th><th className="num">未了余额</th>
                <th>状态</th><th>归属营业日</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {discrepancies.map((d) => (
                <tr key={d.id}>
                  <td>{d.type === 'OVER' ? '长款' : '短款'}</td>
                  <td className="num">{fmtMoney(d.amountCents)}</td>
                  <td className="num">{fmtMoney(d.outstandingCents)}</td>
                  <td><span className={`badge status-${d.status.toLowerCase()}`}>{DISCREPANCY_STATUS[d.status]}</span></td>
                  <td className="mono">{d.attributionDay?.date}</td>
                  <td className="actions-cell">
                    <button className="link" onClick={() => openDetail(d)}>详情</button>
                    {d.status === 'PENDING_CLAIM' && <button className="link" onClick={() => claim(d)}>办理认领</button>}
                    {d.status === 'PENDING_RECOVERY' && <button className="link" onClick={() => responsibility(d)}>责任说明</button>}
                    {d.outstandingCents > 0 && d.type === 'SHORT' && (
                      <button className="link" onClick={() => foundCash(d)}>找到现金</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <div className="card">
          <h3>
            事项详情 · {detail.type === 'OVER' ? '长款' : '短款'} {fmtMoney(detail.amountCents)}
            <button className="link" style={{ float: 'right' }} onClick={() => setDetail(null)}>关闭</button>
          </h3>
          <p className="muted">
            归属营业日 {detail.attributionDay?.date} · 原结柜单 {detail.closing?.sessionNo} · 现金箱 {detail.closing?.cashBox?.code}
          </p>
          <h4>原始盘点（问题发生时的记录）</h4>
          <table className="mini-table">
            <thead><tr><th>面额</th><th>应有</th><th>手点</th><th>机点</th></tr></thead>
            <tbody>
              {detail.closing?.counts
                ?.filter((c) => c.expectedQty !== c.manualQty || (c.machineQty != null && c.machineQty !== c.manualQty))
                .map((c) => (
                  <tr key={c.denomCents} className="changed">
                    <td>{denomLabel(c.denomCents)}</td>
                    <td>{c.expectedQty}</td>
                    <td>{c.manualQty}</td>
                    <td>{c.machineQty ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <h4>处理轨迹（调整记录）</h4>
          <AdjustmentsList adjustments={detail.adjustments ?? []} />
        </div>
      )}
    </div>
  );
}
