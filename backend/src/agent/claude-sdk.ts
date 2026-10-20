import { z } from 'zod';
import { LoansService } from '../loans/loans.service';
import { createTools, ToolDef } from '../tools/tools';
import { ChatReply, ChatTurn } from './agent.service';
import { ChatUnavailable } from './llm';
import { activePromptVersion, systemPrompt } from './prompt';
import { TurnTracker } from './turn';

// The Claude Agent SDK runs its own agent loop, using the Claude plan the
// machine is signed in with (no API key). It gets the same two tools as the
// other chat backend, in process, and nothing else: no built-in tools, no
// create_loan, no files, no settings. Choose it with LLM_PROVIDER=claude-sdk.

const SERVER = 'lablend';
const MODEL_TOOLS = ['list_equipment', 'check_stock'];
const MAX_TURNS = 8;
const MAX_CHARS = 2000;

// The SDK is ES-module only and this backend is CommonJS, so load it with a
// real dynamic import (a plain import() would be compiled to require).
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importEsm = new Function('name', 'return import(name)') as (name: string) => Promise<any>;

// Only the shapes this file reads from the SDK.
interface SdkMessage {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
}
export type SdkQuery = (params: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>;
export interface SdkApi {
  query: SdkQuery;
  tool: (name: string, description: string, shape: z.ZodRawShape, handler: (args: any) => Promise<unknown>) => unknown;
  createSdkMcpServer: (options: { name: string; tools: unknown[] }) => unknown;
}

const SHAPES: Record<string, z.ZodRawShape> = {
  list_equipment: { query: z.string().optional().describe('Filter by name.') },
  check_stock: {
    student_id: z.string().describe('The student id.'),
    item_id: z.string().describe('Equipment id from list_equipment.'),
    quantity: z.number().describe('How many items.'),
    days: z.number().describe('How many days.'),
  },
};

export class ClaudeSdkAgent {
  private readonly defs: ToolDef[];

  constructor(
    private readonly loans: LoansService,
    private readonly loadSdk: () => Promise<SdkApi> = () => importEsm('@anthropic-ai/claude-agent-sdk'),
    private readonly model = process.env.CLAUDE_MODEL,
  ) {
    this.defs = createTools(loans).filter((t) => MODEL_TOOLS.includes(t.name));
  }

  async chat(history: ChatTurn[], studentId: string): Promise<ChatReply> {
    let sdk: SdkApi;
    try {
      sdk = await this.loadSdk();
    } catch (err) {
      throw new ChatUnavailable(`The Claude Agent SDK could not be loaded: ${(err as Error).message}`);
    }

    const turn = new TurnTracker();
    const promptVersion = activePromptVersion();
    const tools = this.defs.map((def) =>
      sdk.tool(def.name, def.description, SHAPES[def.name], async (args: Record<string, unknown>) => {
        // The student id comes from the session, never from the model.
        const input = def.name === 'check_stock' ? { ...args, student_id: studentId } : args;
        const result = await def.run(input);
        turn.record(def.name, input, result);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }),
    );

    const options: Record<string, unknown> = {
      systemPrompt: systemPrompt(studentId, promptVersion),
      mcpServers: { [SERVER]: sdk.createSdkMcpServer({ name: SERVER, tools }) },
      strictMcpConfig: true,
      tools: [], // no built-in tools (no Bash, Read, Edit, ...)
      allowedTools: MODEL_TOOLS.map((n) => `mcp__${SERVER}__${n}`),
      permissionMode: 'dontAsk', // anything not allowed above is denied, not asked
      settingSources: [], // ignore CLAUDE.md and .claude/ settings
      persistSession: false,
      maxTurns: MAX_TURNS,
      ...(this.model ? { model: this.model } : {}),
    };

    let final: SdkMessage | undefined;
    try {
      for await (const message of sdk.query({ prompt: toPrompt(history), options })) {
        if (message.type === 'result') final = message;
      }
    } catch (err) {
      throw new ChatUnavailable(`The Claude Agent SDK failed: ${(err as Error).message}`);
    }

    if (!final) throw new ChatUnavailable('The Claude Agent SDK returned no result.');
    if (final.subtype === 'error_max_turns') {
      return {
        reply: 'I could not finish that request. Please try again with the item, how many and for how many days.',
        toolCalls: turn.toolCalls,
        guardrails: [],
        promptVersion,
      };
    }
    if (final.subtype !== 'success' || final.is_error) {
      const why = final.result || final.errors?.join(' ') || final.subtype;
      throw new ChatUnavailable(`The Claude Agent SDK failed: ${why}. Is Claude Code signed in on this machine?`);
    }
    const text = final.result?.trim() || 'Sorry, I have no answer for that.';
    return { ...(await turn.finish(text, this.loans)), promptVersion };
  }
}

// query() takes one prompt, so the conversation so far goes in as a transcript.
export function toPrompt(history: ChatTurn[]): string {
  const turns = history.slice(-20).map((t) => ({ ...t, content: t.content.slice(0, MAX_CHARS) }));
  if (turns.length === 1) return turns[0].content;
  const lines = turns.map((t) => `${t.role === 'user' ? 'Student' : 'Agent'}: ${t.content}`);
  return `Conversation so far:\n${lines.join('\n')}\n\nReply to the last Student message.`;
}
