export interface Equipment {
  id: string;
  name: string;
  stock: number;
  notes?: string;
}

export interface Loan {
  id: string;
  studentId: string;
  itemId: string;
  quantity: number;
  days: number;
  status: 'active' | 'returned';
  createdAt: string;
}

export interface LabData {
  equipment: Equipment[];
  loans: Loan[];
}

export interface LoanRequest {
  studentId: string;
  itemId: string;
  quantity: number;
  days: number;
}

export type RuleCode =
  | 'MAX_ITEMS_EXCEEDED'
  | 'MAX_DAYS_EXCEEDED'
  | 'OUT_OF_STOCK'
  | 'ITEM_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'NOT_APPROVED';

export interface Violation {
  code: RuleCode;
  reason: string;
}

export interface Proposal extends LoanRequest {
  itemName: string;
}

// The closest request that would pass, offered after a refusal. Only a
// suggestion: it becomes a proposal only after the student says yes.
export interface Suggestion {
  quantity: number;
  days: number;
}

export type CheckResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; code: RuleCode; reason: string; violations: Violation[]; suggestion?: Suggestion };
