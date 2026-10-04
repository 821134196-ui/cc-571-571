import { Fragment, useState } from 'react';
import { Adjustment } from '../types';
import { ADJUSTMENT_TYPE, denomLabel, fmtMoney } from '../format';

/** 调整记录列表：可展开查看各次修正的原始记录（payload 快照） */
export default function AdjustmentsList({ adjustments }: { adjustments: Adjustment[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!adjustments || adjustments.length === 0) {
    return <p className="muted">暂无调整记录</p>;
  }

  const renderPayload = (a: Adjustment) => {
    if (!a.payload) return null;
    let parsed: any;
    try {
      parsed = JSON.parse(a.payload);
    } catch {
      return <pre className="payload">{a.payload}</pre>;
    }
    // 重复结柜修正：前后两套面额数量
    if (a.type === 'RECOUNT_CORRECTION' && parsed.before && parsed.after) {
      const afterMap = new Map<number, number>(parsed.after.map((c: any) => [c.denomCents, c.qty]));
      return (
        <table className="mini-table">
          <thead>
            <tr><th>面额</th><th>修正前（手点）</th><th>修正后（手点）</th><th>机点</th></tr>
          </thead>
          <tbody>
            {parsed.before.map((b: any) => (
              <tr key={b.denomCents} className={afterMap.get(b.denomCents) !== b.manualQty ? 'changed' : ''}>
                <td>{denomLabel(b.denomCents)}</td>
                <td>{b.manualQty}</td>
                <td>{afterMap.get(b.denomCents) ?? '—'}</td>
                <td>{b.machineQty ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    // 跨班交接：双方 + 交接清点
    if (a.type === 'HANDOVER') {
      return (
        <div className="payload">
          <div>交接清点合计：{fmtMoney(parsed.countedCents)}　应有：{fmtMoney(parsed.expectedCents)}</div>
          {parsed.counts && (
            <table className="mini-table">
              <thead><tr><th>面额</th><th>数量</th></tr></thead>
              <tbody>
                {parsed.counts.map((c: any) => (
                  <tr key={c.denomCents}><td>{denomLabel(c.denomCents)}</td><td>{c.qty}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      );
    }
    if (parsed.claimant) return <div className="payload">认领人：{parsed.claimant}</div>;
    return <pre className="payload">{JSON.stringify(parsed, null, 2)}</pre>;
  };

  return (
    <table className="table">
      <thead>
        <tr>
          <th></th><th>单号</th><th>类型</th><th>时间</th><th>说明</th>
          <th className="num">调整前余额</th><th className="num">调整后余额</th>
        </tr>
      </thead>
      <tbody>
        {adjustments.map((a) => (
          <Fragment key={a.id}>
            <tr>
              <td>
                {a.payload && (
                  <button className="link" onClick={() => setOpen({ ...open, [a.id]: !open[a.id] })}>
                    {open[a.id] ? '▾' : '▸'}
                  </button>
                )}
              </td>
              <td className="mono">{a.adjustmentNo}</td>
              <td><span className="badge">{ADJUSTMENT_TYPE[a.type] ?? a.type}</span></td>
              <td className="mono">{new Date(a.createdAt).toLocaleString('zh-CN')}</td>
              <td>{a.note ?? '—'}</td>
              <td className="num">{fmtMoney(a.outstandingBefore)}</td>
              <td className="num">{fmtMoney(a.outstandingAfter)}</td>
            </tr>
            {open[a.id] && (
              <tr className="expand-row">
                <td></td>
                <td colSpan={6}>{renderPayload(a)}</td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
