export interface Equipment {
  id: string;
  name: string;
  stock: number;
  available: number;
  notes?: string;
  // The note reads like an instruction. It is shown as ignored.
  notesFlagged?: boolean;
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

export interface LoanRequest {
  studentId: string;
  itemId: string;
  quantity: number;
  days: number;
}

export interface Violation {
  code: string;
  reason: string;
}

export type Proposal = LoanRequest & { itemName: string };

export interface Suggestion {
  quantity: number;
  days: number;
}

export type CheckResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; code: string; reason: string; violations: Violation[]; suggestion?: Suggestion };

export type CreateResult = { ok: true; loan: Loan } | Extract<CheckResult, { ok: false }>;

async function send<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // 422 carries a rule refusal as JSON; anything else unexpected is an error.
  if (!res.ok && res.status !== 422) throw new Error(`Server error (${res.status})`);
  return res.json() as Promise<T>;
}

// The limits, served from the backend's domain module (never copied here).
export interface Rules {
  maxItems: number;
  maxDays: number;
}

export const getRules = async (): Promise<Rules> => (await fetch('/api/rules')).json();

export const listEquipment = async (): Promise<Equipment[]> => (await fetch('/api/equipment')).json();

export const listLoans = async (studentId: string): Promise<Loan[]> =>
  (await fetch(`/api/loans?studentId=${encodeURIComponent(studentId)}`)).json();

export const checkStock = (req: LoanRequest) => send<CheckResult>('/api/loans/check', req);

// Only called from an Approve button.
export const createLoan = (req: LoanRequest) =>
  send<CreateResult>('/api/loans', {
    studentId: req.studentId,
    itemId: req.itemId,
    quantity: req.quantity,
    days: req.days,
    approved: true,
  });

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSuggestion extends Suggestion {
  itemId: string;
  itemName: string;
}

export interface ChatReply {
  reply: string;
  proposal?: Proposal;
  refusal?: { code: string; reason: string; violations: Violation[] };
  suggestion?: ChatSuggestion;
  toolCalls?: { name: string; ok?: boolean; code?: string }[];
  guardrails?: string[];
  promptVersion?: string;
}

export interface ChatStatus {
  provider: 'claude-sdk' | 'openai-compatible';
  model: string | null;
  configured: boolean;
  promptVersion: string;
}

export const chatStatus = async (): Promise<ChatStatus> => (await fetch('/api/chat/status')).json();

export async function chat(messages: ChatTurn[], studentId: string): Promise<ChatReply> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, studentId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Server error (${res.status})`);
  }
  return res.json() as Promise<ChatReply>;
}
