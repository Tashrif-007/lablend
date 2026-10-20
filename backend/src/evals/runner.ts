import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ChatReply, ChatTurn } from '../agent/agent.service';
import { ChatAgent } from '../agent/chat-agent';
import { PromptVersion } from '../agent/prompt';
import { DataService } from '../data/data.service';
import { LoansService } from '../loans/loans.service';
import { CASES, EvalCase } from './cases';

export interface ConversationResult {
  label: string;
  transcript: ChatTurn[];
  failures: string[];
  guardrails: string[];
  toolCalls: string[];
  ms: number;
}

export interface CaseResult {
  id: number;
  name: string;
  pass: boolean;
  conversations: ConversationResult[];
}

export interface EvalRun {
  promptVersion: PromptVersion;
  backend: string;
  passed: number;
  total: number;
  conversationsPassed: number;
  conversationsTotal: number;
  // Beyond pass/fail, to compare prompts that both pass.
  avgReplyWords: number;
  avgToolCalls: number;
  avgSeconds: number;
  guardrailsFired: number;
  cases: CaseResult[];
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

// Builds a chat agent on a given LoansService (one per conversation, so each
// gets its own temp copy of the data).
export type AgentFactory = (loans: LoansService) => ChatAgent;

export async function runEvals(opts: {
  dataFile: string;
  promptVersion: PromptVersion;
  backend: string;
  makeAgent: AgentFactory;
  cases?: EvalCase[];
  onConversation?: (caseId: number, r: ConversationResult) => void;
}): Promise<EvalRun> {
  const results: CaseResult[] = [];
  for (const c of opts.cases ?? CASES) {
    const conversations: ConversationResult[] = [];
    for (const conv of c.conversations) {
      const r = await runConversation(opts, conv.label, conv.studentId, conv.turns, conv.check);
      opts.onConversation?.(c.id, r);
      conversations.push(r);
    }
    results.push({ id: c.id, name: c.name, pass: conversations.every((r) => r.failures.length === 0), conversations });
  }
  const all = results.flatMap((r) => r.conversations);
  return {
    promptVersion: opts.promptVersion,
    backend: opts.backend,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    conversationsPassed: all.filter((r) => r.failures.length === 0).length,
    conversationsTotal: all.length,
    avgReplyWords: avg(all.map((r) => (r.transcript[r.transcript.length - 1]?.content ?? '').split(/\s+/).filter(Boolean).length)),
    avgToolCalls: avg(all.map((r) => r.toolCalls.length)),
    avgSeconds: avg(all.map((r) => r.ms / 1000)),
    guardrailsFired: all.reduce((n, r) => n + r.guardrails.length, 0),
    cases: results,
  };
}

async function runConversation(
  opts: { dataFile: string; promptVersion: PromptVersion; makeAgent: AgentFactory },
  label: string,
  studentId: string,
  turns: string[],
  check: (r: ChatReply) => string[],
): Promise<ConversationResult> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'lablend-eval-'));
  const file = join(dir, 'data.json');
  await fs.copyFile(opts.dataFile, file);
  const before = await fs.readFile(file, 'utf8');

  const saved = { DATA_FILE: process.env.DATA_FILE, AGENT_PROMPT: process.env.AGENT_PROMPT };
  process.env.DATA_FILE = file;
  process.env.AGENT_PROMPT = opts.promptVersion;
  const agent = opts.makeAgent(new LoansService(new DataService()));

  const transcript: ChatTurn[] = [];
  const failures: string[] = [];
  const guardrails: string[] = [];
  const toolCalls: string[] = [];
  const started = Date.now();
  try {
    let last: ChatReply | undefined;
    for (const text of turns) {
      transcript.push({ role: 'user', content: text });
      last = await agent.chat([...transcript], studentId);
      transcript.push({ role: 'assistant', content: last.reply });
      guardrails.push(...(last.guardrails ?? []));
      toolCalls.push(...(last.toolCalls ?? []).map((t) => (t.code ? `${t.name}:${t.code}` : t.ok === undefined ? t.name : `${t.name}:${t.ok ? 'ok' : 'refused'}`)));
    }
    failures.push(...check(last!));
  } catch (err) {
    failures.push(`error: ${(err as Error).message}`);
  } finally {
    restore('DATA_FILE', saved.DATA_FILE);
    restore('AGENT_PROMPT', saved.AGENT_PROMPT);
  }
  const ms = Date.now() - started;
  if ((await fs.readFile(file, 'utf8')) !== before) failures.push('data.json changed without Approve');
  await fs.rm(dir, { recursive: true, force: true });
  return { label, transcript, failures, guardrails, toolCalls, ms };
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

export function toMarkdown(runs: EvalRun[], when = new Date()): string {
  const head = (r: EvalRun) => `prompt ${r.promptVersion}`;
  const lines = [
    `# LabLend eval results`,
    ``,
    `Run: ${when.toISOString()} · backend: ${runs[0]?.backend ?? '-'}`,
    ``,
    `| Case | ${runs.map(head).join(' | ')} |`,
    `|---|${runs.map(() => '---').join('|')}|`,
  ];
  for (const c of runs[0]?.cases ?? []) {
    const cells = runs.map((r) => {
      const res = r.cases.find((x) => x.id === c.id)!;
      const ok = res.conversations.filter((x) => x.failures.length === 0).length;
      return `${res.pass ? 'pass' : '**fail**'} (${ok}/${res.conversations.length})`;
    });
    lines.push(`| ${c.id}. ${c.name} | ${cells.join(' | ')} |`);
  }
  lines.push(
    `| **Cases passed** | ${runs.map((r) => `**${r.passed}/${r.total}**`).join(' | ')} |`,
    `| Conversations passed | ${runs.map((r) => `${r.conversationsPassed}/${r.conversationsTotal}`).join(' | ')} |`,
    `| Avg reply length (words) | ${runs.map((r) => r.avgReplyWords).join(' | ')} |`,
    `| Avg tool calls | ${runs.map((r) => r.avgToolCalls).join(' | ')} |`,
    `| Avg time per conversation (s) | ${runs.map((r) => r.avgSeconds).join(' | ')} |`,
    `| Guardrails fired | ${runs.map((r) => r.guardrailsFired).join(' | ')} |`,
    ``,
  );

  for (const r of runs) {
    lines.push(`## ${head(r)}`, ``);
    for (const c of r.cases) {
      for (const conv of c.conversations) {
        lines.push(`- **${c.id}. ${c.name}: ${conv.label}**: ${conv.failures.length ? 'FAIL' : 'pass'}`);
        for (const f of conv.failures) lines.push(`  - ${f}`);
        if (conv.toolCalls.length) lines.push(`  - tools: ${conv.toolCalls.join(', ')}`);
        if (conv.guardrails.length) lines.push(`  - guardrails: ${conv.guardrails.join(', ')}`);
        const reply = conv.transcript[conv.transcript.length - 1]?.content ?? '';
        lines.push(`  - reply: "${reply.replace(/\s+/g, ' ')}"`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
