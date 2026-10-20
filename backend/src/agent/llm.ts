// A model-independent LLM client: any OpenAI-compatible chat completions API
// (Ollama, Gemini, Groq, OpenRouter, ...), set in .env. It uses fetch, so it
// adds no dependency.

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface LlmTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmReply {
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface Llm {
  complete(messages: ChatMessage[], tools: LlmTool[]): Promise<LlmReply>;
}

export const LLM = Symbol('LLM');

// The chat agent cannot answer right now; the message says why and is shown to the user.
export class ChatUnavailable extends Error {}

export class LlmNotConfigured extends ChatUnavailable {}

export class OpenAiCompatibleLlm implements Llm {
  constructor(
    private readonly baseUrl = process.env.LLM_BASE_URL,
    private readonly apiKey = process.env.LLM_API_KEY,
    private readonly model = process.env.LLM_MODEL,
    private readonly timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 60_000,
  ) {}

  async complete(messages: ChatMessage[], tools: LlmTool[]): Promise<LlmReply> {
    if (!this.baseUrl || !this.model) {
      throw new LlmNotConfigured('The chat agent is not configured. Set LLM_BASE_URL and LLM_MODEL (and LLM_API_KEY) in .env.');
    }
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, messages, tools, temperature: 0 }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const why = (err as Error).name === 'TimeoutError' ? `no answer within ${this.timeoutMs / 1000} s` : (err as Error).message;
      throw new ChatUnavailable(`Could not reach the model at ${this.baseUrl} (${why}).`);
    }
    if (!res.ok) {
      // The provider's own message says what is wrong (bad key, unknown model, rate limit).
      const text = await res.text().catch(() => '');
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.error?.message ?? parsed?.message ?? text;
      } catch {
        // not JSON: keep the text
      }
      detail = String(detail).replace(/\s+/g, ' ').slice(0, 200);
      throw new ChatUnavailable(`The model API returned ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const body = (await res.json()) as { choices?: { message?: LlmReply }[] };
    const message = body.choices?.[0]?.message;
    if (!message) throw new ChatUnavailable('The model API returned no message.');
    // Some providers send tool arguments as an object instead of a JSON string.
    const toolCalls = message.tool_calls?.map((c) => ({
      ...c,
      type: 'function' as const,
      function: {
        name: c.function.name,
        arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}),
      },
    }));
    return { content: message.content ?? null, tool_calls: toolCalls?.length ? toolCalls : undefined };
  }
}
