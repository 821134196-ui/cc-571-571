import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { DENOMS, diffLabel, fmt, SHIFTS } from '../denoms';
import { BusinessDay, Closing, User } from '../types';
import ClosingDetail from '../components/ClosingDetail';

interface Row {
  expected: string;
  manual: string;
  machine: number | null;
}

export default function ClosingPage({
  user,
  day,
  onError,
}: {
  user: User | null;
  day: BusinessDay | null;
  onError: (msg: string) => void;
}) {
  const [shift, setShift] = useState('MORNING');
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [mine, setMine] = useState<Closing[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const resetRows = useCallback(() => {
    const init: Record<number, Row> = {};
    for (const d of DENOMS) init[d.denomCents] = { expected: '0', manual: '0', machine: null };
    setRows(init);
  }, []);
  useEffect(resetRows, [resetRows]);

  const loadMine = useCallback(() => {
    if (user?.role === 'TELLER') {
      api<Closing[]>('/closings/mine').then(setMine).catch((e) => onError(e.message));
    } else {
      setMine([]);
    }
  }, [user?.id, user?.role]);
  useEffect(loadMine, [loadMine]);

  const sum = (pick: (r: Row) => number) =>
    DENOMS.reduce((s, d) => s + d.denomCents * pick(rows[d.denomCents] ?? { expected: '0', manual: '0', machine: null }), 0);

  const expectedTotal = sum((r) => Number(r.expected) || 0);
  const manualTotal = sum((r) => Number(r.manual) || 0);
  const machineRead = DENOMS.every((d) => rows[d.denomCents]?.machine != null);
  const machineTotal = machineRead ? sum((r) => r.machine ?? 0) : null;
  const conflict = machineTotal != null && machineTotal !== manualTotal;

  async function readMachine() {
    try {
      const res = await api<{ counts: { denomCents: number; qty: number }[] }>('/mock/cash-machine/count', {
        method: 'POST',
        body: JSON.stringify({ seed: 'CASH-MACHINE', denoms: DENOMS.map((d) => d.denomCents) }),
      });
      setRows((prev) => {
        const next = { ...prev };
        for (const c of res.counts) next[c.denomCents] = { ...next[c.denomCents], machine: c.qty };
        return next;
      });
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function submit() {
    if (!user) return;
    try {
      const lines = DENOMS.map((d) => ({
        denomCents: d.denomCents,
        expectedQty: Number(rows[d.denomCents].expected) || 0,
        manualQty: Number(rows[d.denomCents].manual) || 0,
        machineQty: rows[d.denomCents].machine,
      }));
      const created = await api<Closing>('/closings', {
        method: 'POST',
        body: JSON.stringify({ shift, lines }),
      });
      setNotice(
        `结柜单已提交（${diffLabel(created.diffCents)}）${created.warning ? `；${created.warning}` : ''}`,
      );
      resetRows();
      loadMine();
    } catch (e: any) {
      onError(e.message);
    }
  }

  if (user?.role !== 'TELLER') {
    return <p className="hint">请切换到柜员用户（张敏 / 李强）进行结柜盘点。</p>;
  }

  return (
    <div>
      <section className="card">
        <h2>结柜盘点登记 {!day && <span className="warn-text">（当前无营业中的营业日，无法提交）</span>}</h2>
        <div className="toolbar">
          <label>
            班次：
            <select value={shift} onChange={(e) => setShift(e.target.value)}>
              {SHIFTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={readMachine}>读取点钞机</button>
          <span className="hint">点钞结果仅作比对，系统不会自动采信任何一方</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>面额</th>
              <th>应有数量（账面）</th>
              <th>手工盘点</th>
              <th>点钞机</th>
              <th>实盘金额</th>
            </tr>
          </thead>
          <tbody>
            {DENOMS.map((d) => {
              const r = rows[d.denomCents] ?? { expected: '0', manual: '0', machine: null };
              const mismatch = r.machine != null && r.machine !== (Number(r.manual) || 0);
              return (
                <tr key={d.denomCents} className={mismatch ? 'row-conflict' : ''}>
                  <td>{d.label}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.expected}
                      onChange={(e) => setRows((p) => ({ ...p, [d.denomCents]: { ...r, expected: e.target.value } }))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.manual}
                      onChange={(e) => setRows((p) => ({ ...p, [d.denomCents]: { ...r, manual: e.target.value } }))}
                    />
                  </td>
                  <td className="num">{r.machine ?? '—'}</td>
                  <td className="num">{fmt(d.denomCents * (Number(r.manual) || 0))}</td>
                </tr>
              );
            })}
            <tr className="total-row">
              <td>合计</td>
              <td className="num">{fmt(expectedTotal)}</td>
              <td className="num">{fmt(manualTotal)}</td>
              <td className="num">{machineTotal != null ? fmt(machineTotal) : '—'}</td>
              <td className={`num ${manualTotal - expectedTotal > 0 ? 'over' : manualTotal - expectedTotal < 0 ? 'short' : ''}`}>
                {diffLabel(manualTotal - expectedTotal)}
              </td>
            </tr>
          </tbody>
        </table>

        {conflict && (
          <div className="banner warn">
            ⚠ 机器点钞（{fmt(machineTotal)}）与手工盘点（{fmt(manualTotal)}）不一致，请复核。
            系统不会自动认定任何一方正确：提交后需通过「修正记录」确认数量，主管才能复核通过。
          </div>
        )}
        {notice && <div className="banner ok">{notice}</div>}

        <button className="primary" disabled={!day} onClick={submit}>
          提交结柜
        </button>
      </section>

      <section className="card">
        <h2>我的结柜单</h2>
        {mine.length === 0 && <p className="hint">暂无结柜记录</p>}
        {mine.map((c) => (
          <div key={c.id} className="closing-item">
            <div className="closing-head" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
              <span>
                {c.businessDay?.date} {SHIFTS.find((s) => s.value === c.shift)?.label ?? c.shift}
              </span>
              <span className={`status st-${c.status.toLowerCase()}`}>{c.status}</span>
              <span className={c.diffCents > 0 ? 'over' : c.diffCents < 0 ? 'short' : ''}>{diffLabel(c.diffCents)}</span>
              {c.countConflict && <span className="tag-conflict">机器/手工不一致</span>}
              <span className="hint">
                调整 {c.adjustments?.length ?? 0} 次 · 处置 {c.dispositions?.length ?? 0} 笔 {expanded ? '▲ 收起' : '▼ 展开原始记录'}
              </span>
            </div>
            {expanded === c.id && <ClosingDetail id={c.id} onChanged={loadMine} onError={onError} />}
          </div>
        ))}
      </section>
    </div>
  );
}
