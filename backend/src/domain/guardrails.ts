import { MAX_DAYS, MAX_ITEMS } from './loan-rules';

// Guardrails around the model. The hard rule itself is in loan-rules.ts and
// does not depend on any of this: these checks keep untrusted text away from
// the model and keep the model's words honest.

// Text that reads like an instruction to change roles, limits or behaviour.
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore\b.{0,30}\b(instructions?|rules?|limits?|above|previous|prior)\b/i,
  /\b(is|am|i'm|im|as)\s+an?\s+(ta|teaching assistant|admin(istrator)?|staff|lab staff|professor|teacher|superuser)\b/i,
  /\b(allow|give|grant|let|permit)\b.{0,40}\b\d+\s*(items?|kits?|sensors?|units?|days?|weeks?)\b/i,
  /\b(override|bypass|raise|increase|lift|change|disable)\b.{0,30}\b(limits?|rules?|restrictions?)\b/i,
  /\b(system prompt|developer message|new instructions?)\b/i,
  /\byou (must|should|will) now\b/i,
];

export function looksLikeInstruction(text: unknown): boolean {
  return typeof text === 'string' && INSTRUCTION_PATTERNS.some((p) => p.test(text));
}

export const REMOVED = '[removed: text that looked like an instruction]';

// Untrusted text from data.json on its way to a model: anything that reads
// like an instruction is replaced.
export function screenUntrusted(text: string): string {
  return looksLikeInstruction(text) ? REMOVED : text;
}

// Screens every string in a tool result before a model reads it.
export function screenToolResult<T>(value: T): T {
  if (typeof value === 'string') return screenUntrusted(value) as T;
  if (Array.isArray(value)) return value.map(screenToolResult) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, screenToolResult(v)])) as T;
  }
  return value;
}

const CLAIMS_SAVED =
  /\b(has|have|is|was|were)\s+(been\s+)?(saved|booked|approved|confirmed|created|registered|reserved)\b|\bi('ve| have)?\s+(saved|booked|approved|created|reserved)\b|^\W*(approved|booked|saved|confirmed|reserved)\b/i;
// "Nothing is saved until you press Approve" is not a claim.
const NOT_A_CLAIM = /\b(nothing|not|never|no|until|unless|only|once|when|after|if|before|will|would|can|could)\b|n't\b/i;

// The chat model never saves a loan, so any claim that one was saved is false.
export function claimsSaved(reply: string): boolean {
  return reply
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => CLAIMS_SAVED.test(sentence) && !NOT_A_CLAIM.test(sentence));
}

const REFUSAL_WORDS = /\b(can(no|')t|cannot|not allowed|refus|exceed|over the limit|at most|limit|instead|unable|max_)\w*/i;
const COUNT_WORDS = '(items?|kits?|sensors?|motors?|servos?|boards?|units?|pieces?)';

// A reply that offers more than the hard rule allows without refusing it,
// e.g. "Sure, you can take 10 sensors for 30 days."
export function grantsBeyondLimits(reply: string): boolean {
  if (REFUSAL_WORDS.test(reply)) return false;
  const days = [...reply.matchAll(/\b(\d+)\s*days?\b/gi)].map((m) => Number(m[1]));
  const weeks = [...reply.matchAll(/\b(\d+)\s*weeks?\b/gi)].map((m) => Number(m[1]) * 7);
  const items = [...reply.matchAll(new RegExp(`\\b(\\d+)\\s*(\\w+\\s+){0,3}${COUNT_WORDS}\\b`, 'gi'))].map((m) => Number(m[1]));
  return [...days, ...weeks].some((d) => d > MAX_DAYS) || items.some((n) => n > MAX_ITEMS);
}
