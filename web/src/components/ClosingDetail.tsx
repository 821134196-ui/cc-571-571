import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import {
  ADJUSTMENT_TYPE,
  CLOSING_STATUS,
  DENOMS,
  DISPOSITION_KIND,
  DISPOSITION_STATUS,
  diffLabel,
  fmt,
  LEDGER_KIND,
} from '../denoms';
import { Closing } from '../types';

/** 结柜单详情：面额明细、复核记录、调整历史（可展开原始快照）、处置单、账本 */
export default function ClosingDetail({
  id,
  onChanged,
  onError,
}: {
  id: string;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [detail, setDetail] = useState<Closing | null>(null);
  const [adjType, setAdjType] = useState<'CORRECTION' | 'HANDOVER' | 'FOUND_CASH'>('CORRECTION');
  const [adjNote, setAdjNote] = useState('');
  const [adjAmount, setAdjAmount] = useState(''); // 元，FOUND_CASH / HANDOVER 用
  const [finalQty, setFinalQty] = useState<Record<number, string>>({});
  const [openAdj, setOpenAdj] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Closing>(`/closings/${id}`)
      .then((d) => {
        setDetail(d);
        const init: Record<number, string> = {};
        for (const l of d.lines ?? []) init[l.denomCents] = String(l.finalQty);
        setFinalQty(init);
      })
      .catch((e) => onError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function submitAdjustment() {
    try {
      const body: any = { type: adjType, note: adjNote || undefined };
      if (adjType === 'CORRECTION') {
        body.lines = (detail?.lines ?? []).map((l) => ({
          denomCents: l.denomCents,
          finalQty: Number(finalQty[l.denomCents]) || 0,
        }));
      } else {
        body.deltaCents = Math.round(Number(adjAmount) * 100);
      }
      await api(`/closings/${id}/adjustments`, { method: 'POST', body: JSON.stringify(body) });
      setAdjNote('');
      setAdjAmount('');
      load();
      onChanged();
    } catch (e: any) {
      onError(e.message);
    }
  }

  if (!detail) return <div className="hint">加载中…</div>;

  return (
    <div className="detail">
      <div className="detail-grid">
        <div>
          <h3>面额明细（确认数量）</h3>
          <table>
            <thead>
              <tr>
                <th>面额</th>
                <th>应有</th>
                <th>手工</th>
                <th>机器</th>
                <th>确认</th>
              </tr>
            </thead>
            <tbody>
              {(detail.lines ?? []).map((l) => (
                <tr key={l.id} className={l.machineQty != null && l.machineQty !== l.manualQty ? 'row-conflict' : ''}>
                  <td>{DENOMS.find((d) => d.denomCents === l.denomCents)?.label ?? `${l.denomCents}分`}</td>
                  <td className="num">{l.expectedQty}</td>
                  <td className="num">{l.manualQty}</td>
                  <td className="num">{l.machineQty ?? '—'}</td>
                  <td className="num">{l.finalQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            应有 {fmt(detail.expectedCents)} · 实盘 {fmt(detail.actualCents)} ·{' '}
            <strong className={detail.diffCents > 0 ? 'over' : detail.diffCents < 0 ? 'short' : ''}>
              {diffLabel(detail.diffCents)}
            </strong>{' '}
            · 状态 {CLOSING_STATUS[detail.status] ?? detail.status}
            {detail.countConflict && <span className="tag-conflict">机器/手工不一致，待修正确认</span>}
          </p>
        </div>

        <div>
          <h3>复核记录</h3>
          {(detail.reviews ?? []).length === 0 && <p className="hint">尚未复核</p>}
          {(detail.reviews ?? []).map((r) => (
            <p key={r.id}>
              {new Date(r.createdAt).toLocaleString()} {r.reviewer?.name}：
              <strong>{r.decision === 'APPROVE' ? '通过' : '退回'}</strong>
              {r.comment ? `（${r.comment}）` : ''}
            </p>
          ))}

          <h3>处置单</h3>
          {(detail.dispositions ?? []).length === 0 && <p className="hint">无</p>}
          {(detail.dispositions ?? []).map((d) => (
            <p key={d.id}>
              {DISPOSITION_KIND[d.kind]} {fmt(d.amountCents)} — {DISPOSITION_STATUS[d.status] ?? d.status}
            </p>
          ))}

          <h3>账本</h3>
          {(detail.ledgerEntries ?? []).map((e) => (
            <p key={e.id} className="ledger-line">
              {new Date(e.createdAt).toLocaleString()} [{LEDGER_KIND[e.kind] ?? e.kind}] {fmt(e.amountCents)}
            </p>
          ))}
        </div>
      </div>

      <h3>调整记录（{detail.adjustments?.length ?? 0}）</h3>
      {(detail.adjustments ?? []).map((a) => {
        const snapshot = a.linesJson ? (JSON.parse(a.linesJson) as { before: any[]; after: any[] }) : null;
        return (
          <div key={a.id} className="adjustment-item">
            <div className="closing-head" onClick={() => setOpenAdj(openAdj === a.id ? null : a.id)}>
              <span>
                {new Date(a.createdAt).toLocaleString()} [{ADJUSTMENT_TYPE[a.type]}] {fmt(a.deltaCents)}
              </span>
              <span className="hint">
                归属营业日 {a.originBusinessDayId === a.createdBusinessDayId ? '当日' : '原营业日（跨日录入）'}
                {a.note ? ` · ${a.note}` : ''} {openAdj === a.id ? '▲' : '▼ 原始记录'}
              </span>
            </div>
            {openAdj === a.id && snapshot && (
              <table className="snapshot">
                <thead>
                  <tr>
                    <th>面额（分）</th>
                    <th>修正前确认数量</th>
                    <th>修正后确认数量</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.before.map((b: any, i: number) => (
                    <tr key={b.denomCents}>
                      <td className="num">{b.denomCents}</td>
                      <td className="num">{b.finalQty}</td>
                      <td className="num">{snapshot.after[i]?.finalQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <div className="adjust-form">
        <h3>登记调整</h3>
        <div className="toolbar">
          <select value={adjType} onChange={(e) => setAdjType(e.target.value as any)}>
            <option value="CORRECTION">盘点修正</option>
            <option value="HANDOVER">跨班交接差异</option>
            <option value="FOUND_CASH">事后找到现金</option>
          </select>
          <input placeholder="备注" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} />
        </div>
        {adjType === 'CORRECTION' ? (
          <table>
            <thead>
              <tr>
                <th>面额</th>
                <th>修正后确认数量</th>
              </tr>
            </thead>
            <tbody>
              {(detail.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{DENOMS.find((d) => d.denomCents === l.denomCents)?.label ?? l.denomCents}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={finalQty[l.denomCents] ?? '0'}
                      onChange={(e) => setFinalQty((p) => ({ ...p, [l.denomCents]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <label>
            调整金额（元，正=补回现金，负=短缺）：
            <input type="number" step="0.01" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
          </label>
        )}
        <button onClick={submitAdjustment}>提交调整</button>
      </div>
    </div>
  );
}
