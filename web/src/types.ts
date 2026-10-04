export interface User {
  id: string;
  username: string;
  name: string;
  role: 'TELLER' | 'SUPERVISOR' | 'FINANCE';
}

export interface BusinessDay {
  id: string;
  date: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string | null;
}

export interface DenomLine {
  id: string;
  denomCents: number;
  expectedQty: number;
  manualQty: number;
  machineQty: number | null;
  finalQty: number;
}

export interface Disposition {
  id: string;
  closingId: string;
  kind: string;
  amountCents: number;
  status: string;
  createdAt: string;
  closing?: Closing;
}

export interface Adjustment {
  id: string;
  type: string;
  deltaCents: number;
  note: string | null;
  linesJson: string | null;
  originBusinessDayId: string;
  createdBusinessDayId: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  kind: string;
  amountCents: number;
  businessDayId: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface ReviewRec {
  id: string;
  decision: string;
  comment: string | null;
  createdAt: string;
  reviewer: User;
}

export interface Closing {
  id: string;
  shift: string;
  status: string;
  expectedCents: number;
  actualCents: number;
  diffCents: number;
  countConflict: boolean;
  createdAt: string;
  tellerId: string;
  teller?: User;
  businessDay?: BusinessDay;
  lines?: DenomLine[];
  reviews?: ReviewRec[];
  adjustments?: Adjustment[];
  dispositions?: Disposition[];
  ledgerEntries?: LedgerEntry[];
  warning?: string;
}

export interface DayReport {
  day: BusinessDay;
  closings: Closing[];
  totals: {
    count: number;
    expectedCents: number;
    actualCents: number;
    diffCents: number;
    outstandingCents: number;
  };
  ledger: { byKind: Record<string, number>; total: number };
}

export interface FinanceReceipt {
  id: string;
  receiptNo: string;
  dispositionId: string;
  action: string;
  amountCents: number;
  createdAt: string;
}
