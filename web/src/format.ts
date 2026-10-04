export const DENOM_LABELS: Record<number, string> = {
  10000: '100元',
  5000: '50元',
  2000: '20元',
  1000: '10元',
  500: '5元',
  100: '1元',
  50: '5角',
  10: '1角',
};

export function denomLabel(cents: number): string {
  return DENOM_LABELS[cents] ?? `${cents}分`;
}

/** 分 → ￥ 显示 */
export function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}¥${(abs / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const CLOSING_STATUS: Record<string, string> = {
  DRAFT: '盘点中',
  SUBMITTED: '待复核',
  RECOUNT_REQUIRED: '待复盘（机点/手点不一致）',
  REVIEWED: '已复核',
  VOID: '已作废',
};

export const DISCREPANCY_STATUS: Record<string, string> = {
  PENDING_CLAIM: '长款待认领',
  CLAIMED: '长款已认领',
  PENDING_RECOVERY: '短款待缴回',
  RECOVERED: '短款已缴回',
  RESPONSIBILITY_FILED: '已填责任说明',
};

export const ADJUSTMENT_TYPE: Record<string, string> = {
  RECOUNT_CORRECTION: '重复结柜修正',
  HANDOVER: '跨班交接',
  CASH_FOUND: '事后找到现金',
  CLAIM_PAYOUT: '长款认领付出',
  RECOVERY_PAYMENT: '短款缴回',
  RESPONSIBILITY_NOTE: '责任说明',
};
