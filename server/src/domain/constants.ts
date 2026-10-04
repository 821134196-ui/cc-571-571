// 领域常量：与 prisma/schema.prisma 中的 String 状态字段一一对应
export const Roles = {
  TELLER: 'TELLER',
  SUPERVISOR: 'SUPERVISOR',
  FINANCE: 'FINANCE',
} as const;

export const DayStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;

export const ClosingStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  RECOUNT_REQUIRED: 'RECOUNT_REQUIRED',
  REVIEWED: 'REVIEWED',
  VOID: 'VOID',
} as const;

export const DiffType = {
  OVER: 'OVER', // 长款
  SHORT: 'SHORT', // 短款
} as const;

export const DiscrepancyStatus = {
  PENDING_CLAIM: 'PENDING_CLAIM', // 长款待认领
  CLAIMED: 'CLAIMED', // 长款已认领
  PENDING_RECOVERY: 'PENDING_RECOVERY', // 短款待缴回
  RECOVERED: 'RECOVERED', // 短款已缴回
  RESPONSIBILITY_FILED: 'RESPONSIBILITY_FILED', // 已填责任说明
} as const;

export const AdjustmentType = {
  RECOUNT_CORRECTION: 'RECOUNT_CORRECTION', // 重复结柜修正
  HANDOVER: 'HANDOVER', // 跨班交接
  CASH_FOUND: 'CASH_FOUND', // 事后找到现金
  CLAIM_PAYOUT: 'CLAIM_PAYOUT', // 长款认领付出
  RECOVERY_PAYMENT: 'RECOVERY_PAYMENT', // 短款缴回
  RESPONSIBILITY_NOTE: 'RESPONSIBILITY_NOTE', // 责任说明
} as const;

export const ReceiptStatus = {
  APPLIED: 'APPLIED',
  DUPLICATE: 'DUPLICATE',
} as const;

// 台账账户
export const Accounts = {
  cash: (boxCode: string) => `CASH:${boxCode}`,
  OVER_SUSPENSE: 'OVER_SUSPENSE', // 长款待认领（贷方，余额为负）
  SHORT_RECEIVABLE: 'SHORT_RECEIVABLE', // 短款应收（借方，余额为正）
  FINANCE_VAULT: 'FINANCE_VAULT', // 财务金库
} as const;

export const DENOMINATIONS: { denomCents: number; label: string }[] = [
  { denomCents: 10000, label: '100元' },
  { denomCents: 5000, label: '50元' },
  { denomCents: 2000, label: '20元' },
  { denomCents: 1000, label: '10元' },
  { denomCents: 500, label: '5元' },
  { denomCents: 100, label: '1元' },
  { denomCents: 50, label: '5角' },
  { denomCents: 10, label: '1角' },
];
