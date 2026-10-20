import {
  CheckResult,
  LabData,
  LoanRequest,
  Suggestion,
  Violation,
} from './types';

// The hard rule: a student has at most 2 items, for at most 7 days.
export const MAX_ITEMS = 2;
export const MAX_DAYS = 7;

export function refuse(violations: Violation[]): CheckResult {
  return {
    ok: false,
    code: violations[0].code,
    reason: violations.map((v) => v.reason).join(' '),
    violations,
  };
}

const isPositiveInt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1;

const isText = (s: unknown): s is string =>
  typeof s === 'string' && s.trim().length > 0;

function parseRequest(input: unknown): LoanRequest | Violation[] {
  const r = (input ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (!isText(r.studentId)) problems.push('studentId is required.');
  if (!isText(r.itemId)) problems.push('itemId is required.');
  if (!isPositiveInt(r.quantity)) problems.push('quantity must be a whole number, 1 or more.');
  if (!isPositiveInt(r.days)) problems.push('days must be a whole number, 1 or more.');
  if (problems.length) {
    return problems.map((reason) => ({ code: 'INVALID_REQUEST' as const, reason }));
  }
  return {
    studentId: (r.studentId as string).trim(),
    itemId: (r.itemId as string).trim(),
    quantity: r.quantity as number,
    days: r.days as number,
  };
}

// The only place the hard rule is decided. The API, the MCP server and the
// agent all call this, so they cannot disagree. Only the request fields are
// read: text in the data (item notes etc.) never changes the limits.
export function checkLoan(input: unknown, data: LabData): CheckResult {
  const parsed = parseRequest(input);
  if (Array.isArray(parsed)) return refuse(parsed);
  const req = parsed;

  const item = data.equipment.find((e) => e.id === req.itemId);
  if (!item) {
    return refuse([{ code: 'ITEM_NOT_FOUND', reason: `No equipment with id "${req.itemId}".` }]);
  }

  const active = data.loans.filter((l) => l.status === 'active');
  const heldByStudent = active
    .filter((l) => l.studentId === req.studentId)
    .reduce((sum, l) => sum + l.quantity, 0);
  const onLoan = active
    .filter((l) => l.itemId === item.id)
    .reduce((sum, l) => sum + l.quantity, 0);
  const available = item.stock - onLoan;

  const violations: Violation[] = [];
  if (heldByStudent + req.quantity > MAX_ITEMS) {
    violations.push({
      code: 'MAX_ITEMS_EXCEEDED',
      reason: `A student may hold at most ${MAX_ITEMS} items. You hold ${heldByStudent} and asked for ${req.quantity}.`,
    });
  }
  if (req.days > MAX_DAYS) {
    violations.push({
      code: 'MAX_DAYS_EXCEEDED',
      reason: `A loan may last at most ${MAX_DAYS} days. You asked for ${req.days}.`,
    });
  }
  if (req.quantity > available) {
    violations.push({
      code: 'OUT_OF_STOCK',
      reason: `Only ${available} of "${item.name}" available.`,
    });
  }
  if (violations.length) {
    const refusal = refuse(violations);
    const suggestion = closestValid(req, MAX_ITEMS - heldByStudent, available);
    return suggestion && !refusal.ok ? { ...refusal, suggestion } : refusal;
  }

  return { ok: true, proposal: { ...req, itemName: item.name } };
}

// Partly-valid requests: trim to the limits and the stock, so "4 kits for 14
// days" suggests 2 kits for 7 days. Null when nothing of this item can be lent.
function closestValid(req: LoanRequest, itemsLeft: number, available: number): Suggestion | null {
  const quantity = Math.min(req.quantity, itemsLeft, available);
  const days = Math.min(req.days, MAX_DAYS);
  return quantity >= 1 ? { quantity, days } : null;
}

export function availableStock(data: LabData, itemId: string, stock: number): number {
  const onLoan = data.loans
    .filter((l) => l.status === 'active' && l.itemId === itemId)
    .reduce((sum, l) => sum + l.quantity, 0);
  return stock - onLoan;
}
