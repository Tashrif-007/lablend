import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { promises as fs } from 'fs';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { AgentService } from '../src/agent/agent.service';
import { ChatUnavailable, LLM, OpenAiCompatibleLlm } from '../src/agent/llm';
import { PROMPTS } from '../src/agent/prompt';
import { DataService } from '../src/data/data.service';
import { MAX_DAYS, MAX_ITEMS } from '../src/domain/loan-rules';
import { LoansService } from '../src/loans/loans.service';
import { McpServer } from '../src/mcp/mcp-server';
import { createTools } from '../src/tools/tools';
import { fixture } from './fixture';

// "The agent can use any model": the chat agent talks to a real HTTP server
// that speaks the OpenAI chat-completions format, as Ollama, Groq, Gemini and
// OpenRouter do. And "the rule lives in one domain module": every client
// reads the limits from loan-rules.ts.

interface Seen {
  auth?: string;
  body: any;
}

// A fake provider: answers each POST /v1/chat/completions from a script.
async function fakeProvider(script: (body: any, n: number) => { status?: number; json: unknown }) {
  const seen: Seen[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    seen.push({ auth: req.headers.authorization, body });
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404).end('not found');
      return;
    }
    const out = script(body, seen.length - 1);
    res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out.json));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { base, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const message = (m: Record<string, unknown>) => ({ json: { choices: [{ message: m }] } });
const toolCall = (name: string, args: unknown) => message({
  content: null,
  tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: args } }],
});

describe('the agent can use any OpenAI-compatible model', () => {
  let file: string;
  let provider: Awaited<ReturnType<typeof fakeProvider>> | undefined;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lablend-any-'));
    file = join(dir, 'data.json');
    await fs.writeFile(file, JSON.stringify(fixture(), null, 2));
    process.env.DATA_FILE = file;
  });
  afterEach(async () => {
    await provider?.close();
    provider = undefined;
    delete process.env.DATA_FILE;
  });

  const agentFor = (base: string, key = 'test-key', model = 'some-model') =>
    new AgentService(new OpenAiCompatibleLlm(base, key, model), new LoansService(new DataService()));

  it('runs a full tool-calling turn over HTTP and returns the proposal from check_stock', async () => {
    provider = await fakeProvider((body, n) =>
      n === 0
        ? toolCall('check_stock', JSON.stringify({ item_id: 'arduino', quantity: 2, days: 7 }))
        : message({ content: 'Proposal: 2 Arduino Uno Kits for 7 days. Press Approve.' }),
    );
    const before = await fs.readFile(file, 'utf8');
    const out = await agentFor(`${provider.base}/`).chat([{ role: 'user', content: 'two Arduino kits next week' }], 'amy');

    expect(out.proposal).toMatchObject({ studentId: 'amy', itemId: 'arduino', quantity: 2, days: 7 });
    expect(await fs.readFile(file, 'utf8')).toBe(before);

    // What the provider received: the key, the model, the two read tools, the system prompt.
    const [first, second] = provider.seen;
    expect(first.auth).toBe('Bearer test-key');
    expect(first.body.model).toBe('some-model');
    expect(first.body.tools.map((t: any) => t.function.name)).toEqual(['list_equipment', 'check_stock']);
    expect(first.body.messages[0]).toEqual({ role: 'system', content: PROMPTS.v2('amy') });
    // The tool result goes back with the tool_call_id, as the format requires.
    const toolMsg = second.body.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.tool_call_id).toBe('call_1');
    expect(JSON.parse(toolMsg.content)).toMatchObject({ ok: true });
  });

  it('works without a key (Ollama) and with tool arguments sent as an object', async () => {
    provider = await fakeProvider((_b, n) =>
      n === 0 ? toolCall('check_stock', { item_id: 'arduino', quantity: 3, days: 7 }) : message({ content: 'Refused: MAX_ITEMS_EXCEEDED.' }),
    );
    const out = await agentFor(provider.base, '').chat([{ role: 'user', content: 'three kits' }], 'amy');
    expect(provider.seen[0].auth).toBeUndefined();
    expect(out.refusal?.code).toBe('MAX_ITEMS_EXCEEDED');
  });

  it('turns a provider error into a readable message', async () => {
    provider = await fakeProvider(() => ({ status: 401, json: { error: { message: 'Invalid API key' } } }));
    await expect(agentFor(provider.base).chat([{ role: 'user', content: 'hi' }], 'amy')).rejects.toThrow(/401.*Invalid API key/);
  });

  it('says so when the model cannot be reached or is too slow', async () => {
    await expect(agentFor('http://127.0.0.1:1/v1').chat([{ role: 'user', content: 'hi' }], 'amy')).rejects.toThrow(ChatUnavailable);
    const slow = createServer(() => undefined); // never answers
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(slow.address() as AddressInfo).port}/v1`;
    const llm = new OpenAiCompatibleLlm(base, '', 'm', 200);
    await expect(llm.complete([], [])).rejects.toThrow(/no answer within 0.2 s/);
    slow.closeAllConnections();
    await new Promise<void>((r) => slow.close(() => r()));
  });

  it('the chat endpoint answers 503 with the reason, so the UI can show it', async () => {
    provider = await fakeProvider(() => ({ status: 404, json: { error: { message: 'model "nope" not found' } } }));
    const mod = await Test.createTestingModule({ imports: [(await import('../src/app.module')).AppModule] })
      .overrideProvider(LLM)
      .useValue(new OpenAiCompatibleLlm(provider.base, '', 'nope'))
      .compile();
    const app: INestApplication = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const res = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ studentId: 'amy', messages: [{ role: 'user', content: 'hi' }] })
      .expect(503);
    expect(res.body.message).toMatch(/model "nope" not found/);
    await app.close();
  });
});

describe('the rule lives in one domain module', () => {
  beforeEach(async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lablend-rule-'));
    process.env.DATA_FILE = join(dir, 'data.json');
    await fs.writeFile(process.env.DATA_FILE, JSON.stringify(fixture(), null, 2));
  });
  afterEach(() => {
    delete process.env.DATA_FILE;
  });

  it('the API serves the limits from loan-rules.ts for the UI', async () => {
    const mod = await Test.createTestingModule({ imports: [(await import('../src/app.module')).AppModule] }).compile();
    const app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const res = await request(app.getHttpServer()).get('/api/rules').expect(200);
    expect(res.body).toEqual({ maxItems: MAX_ITEMS, maxDays: MAX_DAYS });
    await app.close();
  });

  it('the MCP server tells every client the same limits on initialize', async () => {
    const server = new McpServer(createTools(new LoansService(new DataService())));
    const r = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })) as any;
    expect(r.result.instructions).toContain(`at most ${MAX_ITEMS} items, for at most ${MAX_DAYS} days`);
  });

  it('the prompts state the limits from the constants', () => {
    for (const p of Object.values(PROMPTS)) {
      expect(p('amy')).toContain(`${MAX_ITEMS} items`);
      expect(p('amy')).toContain(`${MAX_DAYS} days`);
    }
  });
});
