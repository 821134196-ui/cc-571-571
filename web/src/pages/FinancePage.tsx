import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import {
  CLOSING_STATUS,
  DISPOSITION_KIND,
  DISPOSITION_STATUS,
  diffLabel,
  fmt,
  LEDGER_KIND,
  SHIFTS,
} from '../denoms';
import { BusinessDay, DayReport, Disposition, FinanceReceipt, User } from '../types';

export default function FinancePage({
  user,
  day,
  onDayChange,
  onError,
}: {
  user: User | null;
  day: BusinessDay | null;
  onDayChange: () => void;
  onError: (m: string) => void;
}) {
  const [pending, setPending] = useState<Disposition[]>([]);
  const [receipts, setReceipts] = useState<FinanceReceipt[]>([]);
  const [days, setDays] = useState<BusinessDay[]>([]);
  const [report, setReport] = useState<DayReport | null>(null);
  const [nextDate, setNextDate] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<Disposition[]>('/finance/pending').then(setPending).catch((e) => onError(e.message));
    api<FinanceReceipt[]>('/finance/receipts').then(setReceipts).catch(() => {});
    api<BusinessDay[]>('/days').then(setDays).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function confirm(id: string) {
    try {
      await api('/finance/confirm', { method: 'POST', body: JSON.stringify({ dispositionId: id }) });
      setNotice('已确认（财务回执已处理）');
      load();
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function reverse(id: string) {
    try {
      await api('/finance/reverse', { method: 'POST', body: JSON.stringify({ dispositionId: id }) });
      setNotice('已冲销');
      load();
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function closeDay() {
    try {
      await api('/days/close', { method: 'POST' });
      setNotice('营业日已关闭');
      onDayChange();
      load();
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function openNext() {
    try {
      await api('/days/open-next', { method: 'POST', body: JSON.stringify({ date: nextDate }) });
      setNotice(`已开启营业日 ${nextDate}`);
      onDayChange();
      load();
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function showReport(dayId: string) {
    try {
      setReport(await api<DayReport>(`/days/${dayId}/report`));
    } catch (e: any) {
      onError(e.message);
    }
  }

  if (user?.role !== 'FINANCE') {
    return <p className="hint">请切换到财务用户（赵磊）进行确认与关账。</p>;
  }

  return (
    <div>
      {notice && <div className="banner ok">{notice}</div>}

      <section className="card">
        <h2>待确认处置（{pending.length}）</h2>
        {pending.length === 0 && <p className="hint">没有待处理的处置单。</p>}
        {pending.map((d) => (
          <div key={d.id} className="closing-head">
            <span>
              {DISPOSITION_KIND[d.kind]} {fmt(d.amountCents)} — {d.closing?.teller?.name}（
              {d.closing?.businessDay?.date}）
            </span>
            <button className="primary" onClick={() => confirm(d.id)}>
              财务确认
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>营业日管理</h2>
        <p>
          当前营业日：{day ? `${day.date}（营业中）` : '无（已全部关闭）'}
          {day && (
            <button className="primary" style={{ marginLeft: 12 }} onClick={closeDay}>
              确认全部事项并关闭营业日
            </button>
          )}
        </p>
        {!day && (
          <p>
            开启下一营业日：
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            <button disabled={!nextDate} onClick={openNext}>
              开启
            </button>
          </p>
        )}
        <h3>营业日报告</h3>
        <div className="toolbar">
          {days.map((d) => (
            <button key={d.id} onClick={() => showReport(d.id)}>
              {d.date}（{d.status === 'OPEN' ? '营业中' : '已关闭'}）
            </button>
          ))}
        </div>
        {report && (
          <div className="report">
            <h3>
              {report.day.date} 报告 <span className="hint">跨日调整按归属记在本营业日</span>
            </h3>
            <p>
              结柜 {report.totals.count} 笔 · 应有 {fmt(report.totals.expectedCents)} · 实盘{' '}
              {fmt(report.totals.actualCents)} · 差额 {diffLabel(report.totals.diffCents)} · 未解决余额{' '}
              {fmt(report.totals.outstandingCents)}
            </p>
            <h4>账本汇总（按类型）</h4>
            <table>
              <tbody>
                {Object.entries(report.ledger.byKind).map(([kind, amount]) => (
                  <tr key={kind}>
                    <td>{LEDGER_KIND[kind] ?? kind}</td>
                    <td className="num">{fmt(amount)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>净额</td>
                  <td className="num">{fmt(report.ledger.total)}</td>
                </tr>
              </tbody>
            </table>
            <h4>结柜单</h4>
            <table>
              <thead>
                <tr>
                  <th>柜员</th>
                  <th>班次</th>
                  <th>状态</th>
                  <th>差额</th>
                  <th>调整</th>
                  <th>处置</th>
                </tr>
              </thead>
              <tbody>
                {report.closings.map((c) => (
                  <tr key={c.id}>
                    <td>{c.teller?.name}</td>
                    <td>{SHIFTS.find((s) => s.value === c.shift)?.label ?? c.shift}</td>
                    <td>{CLOSING_STATUS[c.status] ?? c.status}</td>
                    <td className="num">{diffLabel(c.diffCents)}</td>
                    <td className="num">{c.adjustments?.length ?? 0} 次</td>
                    <td>
                      {(c.dispositions ?? [])
                        .map((d) => `${DISPOSITION_KIND[d.kind]}${fmt(d.amountCents)}(${DISPOSITION_STATUS[d.status]})`)
                        .join('；') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>最近财务回执</h2>
        <table>
          <thead>
            <tr>
              <th>回执号</th>
              <th>动作</th>
              <th>金额</th>
              <th>时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.receiptNo}</td>
                <td>{r.action === 'CONFIRM' ? '确认' : '冲销'}</td>
                <td className="num">{fmt(r.amountCents)}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  {r.action === 'CONFIRM' && (
                    <button onClick={() => reverse(r.dispositionId)}>冲销该笔</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">回执号唯一：重复提交同一回执只会返回原处理结果，不会重复确认或重复冲销。</p>
      </section>
    </div>
  );
}
