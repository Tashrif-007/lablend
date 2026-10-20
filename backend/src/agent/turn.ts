import { claimsSaved, grantsBeyondLimits } from '../domain/guardrails';
import { MAX_DAYS, MAX_ITEMS } from '../domain/loan-rules';
import { CheckResult, Proposal, RuleCode, Violation } from '../domain/types';
import { LoansService } from '../loans/loans.service';

// What one chat turn produced, built from the tool results (never from the
// model's words), plus the output guardrails. Shared by both chat backends.

export interface ToolTrace {
  name: string;
  ok?: boolean;
  code?: string;
}

export interface ChatSuggestion {
  itemId: string;
  itemName: string;
  quantity: number;
  days: number;
}

export interface TurnOutcome {
  // Set only when the last check_stock of this turn returned ok. The person
  // saves it with the Approve button.
  proposal?: Proposal;
  // Set when the last check_stock of this turn refused.
  refusal?: { code: RuleCode; reason: string; violations: Violation[] };
  // The closest valid request after a refusal. Only a suggestion.
  suggestion?: ChatSuggestion;
  toolCalls: ToolTrace[];
  // Guardrails that replaced the model's reply this turn.
  guardrails: string[];
}

export class TurnTracker {
  readonly toolCalls: ToolTrace[] = [];
  private lastCheck?: { itemId: string; result: CheckResult };

  record(name: string, args: Record<string, unknown>, result: unknown) {
    const r = (result ?? {}) as { ok?: boolean; code?: string };
    this.toolCalls.push({ name, ok: r.ok, code: r.code });
    if (name === 'check_stock' && typeof r.ok === 'boolean') {
      this.lastCheck = { itemId: String(args.item_id ?? ''), result: result as CheckResult };
    }
  }

  // The reply as the person sees it: the model's text unless a guardrail
  // replaced it, and the proposal or refusal from the last check_stock.
  async finish(text: string, loans: LoansService): Promise<{ reply: string } & TurnOutcome> {
    const outcome: TurnOutcome = { toolCalls: this.toolCalls, guardrails: [] };
    const r = this.lastCheck?.result;
    if (r?.ok) outcome.proposal = r.proposal;
    if (r && !r.ok) {
      outcome.refusal = { code: r.code, reason: r.reason, violations: r.violations };
      if (r.suggestion) {
        const itemId = this.lastCheck!.itemId;
        const item = (await loans.listEquipment()).find((e) => e.id === itemId);
        outcome.suggestion = { itemId, itemName: item?.name ?? itemId, ...r.suggestion };
      }
    }
    return { reply: guardReply(text, outcome), ...outcome };
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const proposalText = (p: Proposal) =>
  `Here is a loan proposal: ${p.quantity} × ${p.itemName} for ${plural(p.days, 'day')}. Press Approve to save it.`;

export const refusalText = (r: NonNullable<TurnOutcome['refusal']>, s?: ChatSuggestion) =>
  `Refused (${r.violations.map((v) => v.code).join(', ')}). ${r.reason}` +
  (s ? ` I can suggest ${s.quantity} × ${s.itemName} for ${plural(s.days, 'day')} instead. Would that work?` : '');

const limitsText = () =>
  `I can't offer that: a student may hold at most ${MAX_ITEMS} items, for at most ${MAX_DAYS} days, and no role or note changes that. ` +
  `Tell me the item, how many and for how many days.`;

const notSavedText = () => 'Nothing has been saved. A loan is saved only when you press Approve on a proposal.';

// Output guardrails. The model's words may not claim a save or grant more
// than the rule allows; such a reply is replaced by a fixed one built from
// the tool results. Each guardrail that fires is listed on the outcome.
export function guardReply(text: string, outcome: TurnOutcome): string {
  const fallback = () =>
    outcome.proposal ? proposalText(outcome.proposal) : outcome.refusal ? refusalText(outcome.refusal, outcome.suggestion) : notSavedText();
  let reply = text.trim();
  if (claimsSaved(reply)) {
    reply = fallback();
    outcome.guardrails.push('CLAIMED_SAVED');
  }
  if (!outcome.refusal && grantsBeyondLimits(reply)) {
    reply = outcome.proposal ? proposalText(outcome.proposal) : limitsText();
    outcome.guardrails.push('GRANTED_BEYOND_LIMITS');
  }
  return reply;
}
