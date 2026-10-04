export const DENOMS: { denomCents: number; label: string }[] = [
  { denomCents: 10000, label: '100元' },
  { denomCents: 5000, label: '50元' },
  { denomCents: 2000, label: '20元' },
  { denomCents: 1000, label: '10元' },
  { denomCents: 500, label: '5元' },
  { denomCents: 100, label: '1元' },
  { denomCents: 50, label: '5角' },
  { denomCents: 10, label: '1角' },
];

export const SHIFTS = [
  { value: 'MORNING', label: '早班' },
  { value: 'EVENING', label: '晚班' },
];

export function fmt(cents: number | null | undefined): string {
  if (cents == null) return '-';
  const sign = cents < 0 ? '-' : '';
  return `${sign}¥${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function diffLabel(cents: number): string {
  if (cents > 0) return `长款 ${fmt(cents)}`;
  if (cents < 0) return `短款 ${fmt(cents)}`;
  return '账实相符';
}

export const DISPOSITION_KIND: Record<string, string> = {
  OVERAGE_CLAIM: '长款待认领',
  SHORTAGE_PAYBACK: '短款缴回',
  SHORTAGE_STATEMENT: '短款责任说明',
};

export const ADJUSTMENT_TYPE: Record<string, string> = {
  CORRECTION: '盘点修正',
  HANDOVER: '跨班交接',
  FOUND_CASH: '事后找到现金',
};

export const LEDGER_KIND: Record<string, string> = {
  CLOSING_DIFF: '结柜差额',
  ADJUSTMENT: '调整',
  PAYBACK: '缴回入账',
  CLAIM_OUT: '认领出账',
  STATEMENT: '责任说明挂账',
  REVERSAL: '财务冲销',
};

export const CLOSING_STATUS: Record<string, string> = {
  SUBMITTED: '待复核',
  REJECTED: '已退回',
  REVIEWED: '已复核',
  SETTLED: '已结清',
};

export const DISPOSITION_STATUS: Record<string, string> = {
  PENDING: '待处理',
  CONFIRMED: '已确认',
  REVERSED: '已冲销',
  CANCELLED: '已合并取消',
};
