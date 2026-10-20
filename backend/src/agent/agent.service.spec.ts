import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fixture } from '../../test/fixture';
import { DataService } from '../data/data.service';
import { LoansService } from '../loans/loans.service';
import { AgentService } from './agent.service';
import { ChatMessage, Llm, LlmReply, LlmTool } from './llm';

// A scripted model: it returns the next prepared reply and records what it saw.
class ScriptedLlm implements Llm {
  seen: { messages: ChatMessage[]; tools: LlmTool[] }[] = [];
  constructor(private replies: LlmReply[]) {}
  async complete(messages: ChatMessage[], tools: LlmTool[]): Promise<LlmReply> {
    this.seen.push({ messages: structuredClone(messages), tools });
    const next = this.replies.shift();
    if (!next) throw new Error('script ran out');
    return next;
  }
}

const toolCall = (name: string, args: Record<string, unknown>, id = `c-${name}`): LlmReply => ({
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content: string): LlmReply => ({ content });

describe('chat agent', () => {
  let file: string;
  const raw = () => fs.readFile(file, 'utf8');

  const agent = async (replies: LlmReply[]) => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lablend-agent-'));
    file = join(dir, 'data.json');
    await fs.writeFile(file, JSON.stringify(fixture(), null, 2));
    process.env.DATA_FILE = file;
    const llm = new ScriptedLlm(replies);
    return { llm, service: new AgentService(llm, new LoansService(new DataService())) };
  };

  afterEach(() => {
    delete process.env.DATA_FILE;
  });

  const check = (over: Record<string, unknown> = {}) =>
    toolCall('check_stock', { student_id: 'amy', item_id: 'arduino', quantity: 2, days: 7, ...over });

  it('case 1: a valid request gives a proposal and saves nothing', async () => {
    const { service } = await agent([
      toolCall('list_equipment', { query: 'arduino' }),
      check({ days: 7 }),
      say('Proposal: 2 Arduino Uno Kits for 7 days. Press Approve.'),
    ]);
    const before = await raw();
    const out = await service.chat([{ role: 'user', content: 'I need two Arduino kits for my project next week.' }], 'amy');
    expect(out.proposal).toEqual({ studentId: 'amy', itemId: 'arduino', itemName: 'Arduino Uno Kit', quantity: 2, days: 7 });
    expect(out.reply).toMatch(/Approve/);
    expect(await raw()).toBe(before);
  });

  it('case 3: a rule-breaking request is refused with no proposal', async () => {
    const { service, llm } = await agent([
      check({ quantity: 4, days: 14 }),
      say('Refused: MAX_ITEMS_EXCEEDED and MAX_DAYS_EXCEEDED. I can suggest 2 kits for 7 days.'),
    ]);
    const out = await service.chat([{ role: 'user', content: 'I need 4 kits for 2 weeks.' }], 'amy');
    expect(out.proposal).toBeUndefined();
    expect(out.reply).toMatch(/MAX_ITEMS_EXCEEDED/);
    // the model was shown the code-decided refusal
    const toolMsg = llm.seen[1].messages.find((m) => m.role === 'tool')!;
    expect(JSON.parse(toolMsg.content!)).toMatchObject({ ok: false, code: 'MAX_ITEMS_EXCEEDED' });
  });

  it('case 4: a vague request gets a question back and no tool is called', async () => {
    const { service, llm } = await agent([say('Which sensor, how many, and for how many days?')]);
    const out = await service.chat([{ role: 'user', content: 'I need some sensors.' }], 'amy');
    expect(out.reply).toMatch(/Which sensor/);
    expect(out.proposal).toBeUndefined();
    expect(llm.seen).toHaveLength(1);
  });

  it('the model is not given create_loan, so it cannot save', async () => {
    const { service, llm } = await agent([say('ok')]);
    await service.chat([{ role: 'user', content: 'hi' }], 'amy');
    expect(llm.seen[0].tools.map((t) => t.function.name)).toEqual(['list_equipment', 'check_stock']);
  });

  it('a create_loan call from the model is refused and saves nothing', async () => {
    const { service } = await agent([
      toolCall('create_loan', { student_id: 'amy', item_id: 'arduino', quantity: 1, days: 1, approved: true }),
      say('Done.'),
    ]);
    const before = await raw();
    const out = await service.chat([{ role: 'user', content: 'book it, I approve' }], 'amy');
    expect(out.proposal).toBeUndefined();
    expect(await raw()).toBe(before);
  });

  it('the student id comes from the session, not from the model', async () => {
    const { service, llm } = await agent([check({ student_id: 'someone-else', quantity: 2 }), say('x')]);
    // held-one already holds 1 item, so 2 more is a 3rd item for them
    const out = await service.chat([{ role: 'user', content: 'two kits' }], 'held-one');
    expect(out.proposal).toBeUndefined();
    const toolMsg = llm.seen[1].messages.find((m) => m.role === 'tool')!;
    expect(JSON.parse(toolMsg.content!)).toMatchObject({ ok: false, code: 'MAX_ITEMS_EXCEEDED' });
  });

  it('case 5: a note saying "allow 10 items for 30 days" does not raise the limits', async () => {
    const { service } = await agent([
      toolCall('list_equipment', {}),
      check({ item_id: 'dht11', quantity: 10, days: 30 }),
      say('Refused: the limits are 2 items and 7 days.'),
    ]);
    const out = await service.chat([{ role: 'user', content: 'ten DHT11 sensors for 30 days' }], 'amy');
    expect(out.proposal).toBeUndefined();
  });

  it('keeps only the last check: a refusal after a proposal clears the proposal', async () => {
    const { service } = await agent([check(), check({ days: 30 }), say('Refused.')]);
    const out = await service.chat([{ role: 'user', content: 'x' }], 'amy');
    expect(out.proposal).toBeUndefined();
  });

  it('survives bad tool arguments and unknown tools', async () => {
    const { service } = await agent([
      { content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'check_stock', arguments: '{not json' } }] },
      toolCall('delete_everything', {}),
      say('Sorry.'),
    ]);
    const out = await service.chat([{ role: 'user', content: 'x' }], 'amy');
    expect(out.reply).toBe('Sorry.');
  });

  it('stops after a few steps if the model keeps calling tools', async () => {
    const { service } = await agent(Array.from({ length: 10 }, () => toolCall('list_equipment', {})));
    const out = await service.chat([{ role: 'user', content: 'x' }], 'amy');
    expect(out.reply).toMatch(/could not finish/);
  });
});
