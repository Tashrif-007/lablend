import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fixture } from '../../test/fixture';
import { DataService } from '../data/data.service';
import { LoansService } from '../loans/loans.service';
import { ClaudeSdkAgent, SdkApi, toPrompt } from './claude-sdk';
import { ChatUnavailable } from './llm';

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;

// A fake SDK: it records the options and lets a script act as "the model" by
// calling the registered tool handlers, then ends with a result message.
function fakeSdk(script: (call: (name: string, args: Record<string, unknown>) => Promise<unknown>) => Promise<string>, subtype = 'success') {
  const seen: { prompt?: string; options?: Record<string, any> } = {};
  const sdk: SdkApi = {
    tool: (name, _d, _s, handler) => ({ name, handler }),
    createSdkMcpServer: ({ tools }) => ({ tools }),
    query: ({ prompt, options }) => {
      seen.prompt = prompt;
      seen.options = options;
      return (async function* () {
        const tools = (options.mcpServers as any).lablend.tools as { name: string; handler: Handler }[];
        const call = async (name: string, args: Record<string, unknown>) => {
          const t = tools.find((x) => x.name === name);
          if (!t) throw new Error(`tool not offered: ${name}`);
          return JSON.parse((await t.handler(args)).content[0].text);
        };
        const text = await script(call);
        yield { type: 'assistant' };
        yield { type: 'result', subtype, is_error: subtype !== 'success', result: text };
      })();
    },
  };
  return { sdk, seen };
}

describe('Claude Agent SDK chat backend', () => {
  let file: string;
  const raw = () => fs.readFile(file, 'utf8');
  const agent = async (sdk: SdkApi) => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lablend-sdk-'));
    file = join(dir, 'data.json');
    await fs.writeFile(file, JSON.stringify(fixture(), null, 2));
    process.env.DATA_FILE = file;
    return new ClaudeSdkAgent(new LoansService(new DataService()), async () => sdk);
  };
  const ask = (content: string) => [{ role: 'user' as const, content }];

  afterEach(() => {
    delete process.env.DATA_FILE;
  });

  it('gives the model only the two read tools, with no built-ins and no settings', async () => {
    const { sdk, seen } = fakeSdk(async () => 'Which sensor, how many, and for how many days?');
    const out = await (await agent(sdk)).chat(ask('I need some sensors.'), 'amy');
    expect(out).toEqual({
      reply: 'Which sensor, how many, and for how many days?',
      toolCalls: [],
      guardrails: [],
      promptVersion: 'v2',
    });
    const tools = (seen.options!.mcpServers.lablend.tools as { name: string }[]).map((t) => t.name);
    expect(tools).toEqual(['list_equipment', 'check_stock']); // never create_loan
    expect(seen.options).toMatchObject({
      tools: [],
      allowedTools: ['mcp__lablend__list_equipment', 'mcp__lablend__check_stock'],
      permissionMode: 'dontAsk',
      settingSources: [],
      strictMcpConfig: true,
    });
    expect(seen.options!.systemPrompt).toMatch(/"amy"/);
  });

  it('case 1: a proposal comes from check_stock and nothing is saved', async () => {
    const { sdk } = fakeSdk(async (call) => {
      await call('check_stock', { student_id: 'amy', item_id: 'arduino', quantity: 2, days: 7 });
      return 'Press Approve.';
    });
    const before = await raw();
    const out = await (await agent(sdk)).chat(ask('two Arduino kits next week'), 'amy');
    expect(out.proposal).toEqual({ studentId: 'amy', itemId: 'arduino', itemName: 'Arduino Uno Kit', quantity: 2, days: 7 });
    expect(await raw()).toBe(before);
  });

  it('case 3: a rule-breaking request gives no proposal', async () => {
    const { sdk } = fakeSdk(async (call) => {
      const r = (await call('check_stock', { student_id: 'amy', item_id: 'arduino', quantity: 4, days: 14 })) as { code: string };
      return `Refused: ${r.code}`;
    });
    const out = await (await agent(sdk)).chat(ask('4 kits for 2 weeks'), 'amy');
    expect(out.proposal).toBeUndefined();
    expect(out.reply).toBe('Refused: MAX_ITEMS_EXCEEDED');
  });

  it('the student id comes from the session, not from the model', async () => {
    const { sdk } = fakeSdk(async (call) => {
      await call('check_stock', { student_id: 'someone-else', item_id: 'arduino', quantity: 2, days: 7 });
      return 'x';
    });
    // held-one already holds 1 item, so 2 more would be a 3rd item for them
    const out = await (await agent(sdk)).chat(ask('two kits'), 'held-one');
    expect(out.proposal).toBeUndefined();
  });

  it('create_loan is not reachable', async () => {
    const { sdk } = fakeSdk(async (call) => {
      await call('create_loan', { student_id: 'amy', item_id: 'arduino', quantity: 1, days: 1, approved: true });
      return 'Done.';
    });
    const before = await raw();
    await expect((await agent(sdk)).chat(ask('book it'), 'amy')).rejects.toThrow(ChatUnavailable);
    expect(await raw()).toBe(before);
  });

  it('reports a SDK failure as unavailable, with the reason', async () => {
    const { sdk } = fakeSdk(async () => 'Not logged in', 'error_during_execution');
    await expect((await agent(sdk)).chat(ask('hi'), 'amy')).rejects.toThrow(/Not logged in/);
  });

  it('reports a SDK that cannot be loaded as unavailable', async () => {
    const a = new ClaudeSdkAgent(new LoansService(new DataService()), async () => {
      throw new Error('boom');
    });
    await expect(a.chat(ask('hi'), 'amy')).rejects.toThrow(/could not be loaded: boom/);
  });

  it('turns the conversation into one prompt', () => {
    expect(toPrompt(ask('hello'))).toBe('hello');
    expect(
      toPrompt([
        { role: 'user', content: 'some sensors' },
        { role: 'assistant', content: 'Which one?' },
        { role: 'user', content: 'ultrasonic, 2, 5 days' },
      ]),
    ).toBe(
      'Conversation so far:\nStudent: some sensors\nAgent: Which one?\nStudent: ultrasonic, 2, 5 days\n\nReply to the last Student message.',
    );
  });
});
