export interface DenomCount {
  id: string;
  denomCents: number;
  expectedQty: number;
  manualQty: number;
  machineQty: number | null;
}

export interface Adjustment {
  id: string;
  adjustmentNo: string;
  type: string;
  amountCents: number;
  outstandingBefore: number;
  outstandingAfter: number;
  note: string | null;
  payload: string | null;
  operatorId: string;
  postedDayId: string;
  createdAt: string;
}

export interface Discrepancy {
  id: string;
  closingId: string;
  type: 'OVER' | 'SHORT';
  amountCents: number;
  outstandingCents: number;
  confirmedCents: number;
  status: string;
  responsibilityNote: string | null;
  financeAckedAt: string | null;
  attributionDayId: string;
  attributionDay?: BusinessDay;
  adjustments?: Adjustment[];
  receipts?: FinanceReceipt[];
  closing?: Closing;
}

export interface FinanceReceipt {
  id: string;
  receiptNo: string;
  amountCents: number;
  status: string;
  createdAt: string;
}

export interface CashBox {
  id: string;
  code: string;
  name: string;
  tellerId: string;
}

export interface BusinessDay {
  id: string;
  date: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
}

export interface Closing {
  id: string;
  sessionNo: string;
  businessDayId: string;
  businessDay?: BusinessDay;
  cashBoxId: string;
  cashBox?: CashBox;
  tellerId: string;
  status: string;
  expectedCents: number;
  manualCents: number;
  machineCents: number | null;
  machineMismatch: boolean;
  diffCents: number;
  counts: DenomCount[];
  discrepancy: Discrepancy | null;
  adjustments: Adjustment[];
  reviewNote: string | null;
  createdAt: string;
}

export interface ReconcileResult {
  accounts: Record<string, number>;
  balanced: boolean;
  checks: {
    overSuspenseMatchesOpenClaims: boolean;
    shortReceivableMatchesOpenRecoveries: boolean;
  };
  open: { overCents: number; shortCents: number };
}
