import { Inject, Injectable } from '@nestjs/common';
import { LoansService } from '../loans/loans.service';
import { createTools, ToolDef } from '../tools/tools';
import { ChatMessage, Llm, LLM, LlmTool } from './llm';
import { activePromptVersion, systemPrompt } from './prompt';
import { TurnOutcome, TurnTracker } from './turn';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatReply extends Partial<TurnOutcome> {
  reply: string;
  promptVersion?: string;
}

const MAX_STEPS = 6;
const MAX_TURNS = 20;
const MAX_CHARS = 2000;
// create_loan is never given to the model: only the Approve button saves.
const MODEL_TOOLS = ['list_equipment', 'check_stock'];

@Injectable()
export class AgentService {
  private readonly tools: ToolDef[];

  constructor(
    @Inject(LLM) private readonly llm: Llm,
    private readonly loans: LoansService,
  ) {
    this.tools = createTools(loans).filter((t) => MODEL_TOOLS.includes(t.name));
  }

  async chat(history: ChatTurn[], studentId: string): Promise<ChatReply> {
    const promptVersion = activePromptVersion();
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(studentId, promptVersion) },
      ...history.slice(-MAX_TURNS).map((t) => ({ role: t.role, content: t.content.slice(0, MAX_CHARS) })),
    ];
    const llmTools: LlmTool[] = this.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    const turn = new TurnTracker();

    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await this.llm.complete(messages, llmTools);
      if (!reply.tool_calls?.length) {
        const text = reply.content?.trim() || 'Sorry, I have no answer for that.';
        return { ...(await turn.finish(text, this.loans)), promptVersion };
      }
      messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.tool_calls });
      for (const call of reply.tool_calls) {
        const { args, result } = await this.runTool(call.function.name, call.function.arguments, studentId);
        turn.record(call.function.name, args, result);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return {
      reply: 'I could not finish that request. Please try again with the item, how many and for how many days.',
      toolCalls: turn.toolCalls,
      guardrails: [],
      promptVersion,
    };
  }

  private async runTool(name: string, rawArgs: string, studentId: string): Promise<{ args: Record<string, unknown>; result: unknown }> {
    let args: Record<string, unknown> = {};
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) return { args, result: { error: `Unknown tool: ${name}` } };
    try {
      const parsed = JSON.parse(rawArgs || '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      args = parsed;
    } catch {
      return { args, result: { error: 'Tool arguments must be a JSON object.' } };
    }
    // The student id comes from the session, never from the model.
    if (name === 'check_stock') args.student_id = studentId;
    try {
      return { args, result: await tool.run(args) };
    } catch (err) {
      return { args, result: { error: (err as Error).message } };
    }
  }
}
