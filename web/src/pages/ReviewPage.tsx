import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { DENOMS, diffLabel, fmt, SHIFTS } from '../denoms';
import { Closing, User } from '../types';

export default function ReviewPage({ user, onError }: { user: User | null; onError: (m: string) => void }) {
  const [pending, setPending] = useState<Closing[]>([]);
  const [comment, setComment] = useState<Record<string, string>>({});
  const [shortageKind, setShortageKind] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<Closing[]>('/closings/pending-review').then(setPending).catch((e) => onError(e.message));
  }, []);
  useEffect(load, [load]);

  async function review(closingId: string, decision: 'APPROVE' | 'REJECT', diffCents: number) {
    try {
      await api('/reviews', {
        method: 'POST',
        body: JSON.stringify({
          closingId,
          decision,
          comment: comment[closingId] || undefined,
          shortageKind: diffCents < 0 ? shortageKind[closingId] ?? 'SHORTAGE_PAYBACK' : undefined,
        }),
      });
      setNotice(decision === 'APPROVE' ? '已复核通过' : '已退回柜员');
      load();
    } catch (e: any) {
      onError(e.message);
    }
  }

  if (user?.role !== 'SUPERVISOR') {
    return <p className="hint">请切换到主管用户（王芳）进行复核。</p>;
  }

  return (
    <div>
      {notice && <div className="banner ok">{notice}</div>}
      {pending.length === 0 && <p className="hint">没有待复核的结柜单。</p>}
      {pending.map((c) => {
        const isSelf = c.tellerId === user.id;
        return (
          <section key={c.id} className="card">
            <h2>
              {c.businessDay?.date} {SHIFTS.find((s) => s.value === c.shift)?.label} — {c.teller?.name}
              <span className={c.diffCents > 0 ? 'over' : c.diffCents < 0 ? 'short' : ''}>（{diffLabel(c.diffCents)}）</span>
            </h2>
            {c.countConflict && (
              <div className="banner warn">⚠ 机器点钞与手工盘点不一致，须柜员提交修正记录确认后才能复核通过。</div>
            )}
            <table>
              <thead>
                <tr>
                  <th>面额</th>
                  <th>应有</th>
                  <th>手工</th>
                  <th>机器</th>
                  <th>差额</th>
                </tr>
              </thead>
              <tbody>
                {(c.lines ?? []).map((l) => (
                  <tr key={l.id} className={l.machineQty != null && l.machineQty !== l.manualQty ? 'row-conflict' : ''}>
                    <td>{DENOMS.find((d) => d.denomCents === l.denomCents)?.label ?? l.denomCents}</td>
                    <td className="num">{l.expectedQty}</td>
                    <td className="num">{l.manualQty}</td>
                    <td className="num">{l.machineQty ?? '—'}</td>
                    <td className="num">{fmt(l.denomCents * (l.finalQty - l.expectedQty))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              应有 {fmt(c.expectedCents)} · 实盘 {fmt(c.actualCents)} · 差额 {fmt(c.diffCents)}
            </p>
            <div className="toolbar">
              <input
                placeholder="复核意见"
                value={comment[c.id] ?? ''}
                onChange={(e) => setComment((p) => ({ ...p, [c.id]: e.target.value }))}
              />
              {c.diffCents < 0 && (
                <select
                  value={shortageKind[c.id] ?? 'SHORTAGE_PAYBACK'}
                  onChange={(e) => setShortageKind((p) => ({ ...p, [c.id]: e.target.value }))}
                >
                  <option value="SHORTAGE_PAYBACK">短款缴回</option>
                  <option value="SHORTAGE_STATEMENT">责任说明</option>
                </select>
              )}
              <button
                className="primary"
                disabled={isSelf || c.countConflict}
                title={isSelf ? '柜员不能复核本人结柜单' : c.countConflict ? '存在机器/手工不一致' : ''}
                onClick={() => review(c.id, 'APPROVE', c.diffCents)}
              >
                复核通过
              </button>
              <button disabled={isSelf} onClick={() => review(c.id, 'REJECT', c.diffCents)}>
                退回
              </button>
            </div>
            {isSelf && <p className="warn-text">这是您本人的结柜单，不能自复核。</p>}
          </section>
        );
      })}
    </div>
  );
}
