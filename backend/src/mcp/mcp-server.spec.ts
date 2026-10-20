import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fixture } from '../../test/fixture';
import { DataService } from '../data/data.service';
import { LoansService } from '../loans/loans.service';
import { createTools } from '../tools/tools';
import { McpServer } from './mcp-server';

describe('MCP server', () => {
  let file: string;
  let server: McpServer;
  let id = 0;

  const rpc = (method: string, params?: unknown) => server.handle({ jsonrpc: '2.0', id: ++id, method, params });
  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await rpc('tools/call', { name, arguments: args });
    const result = reply!.result as { isError?: boolean; content: { text: string }[] };
    return { isError: result.isError, data: JSON.parse(result.content[0].text) };
  };
  const loan = (over: Record<string, unknown> = {}) => ({
    student_id: 'amy',
    item_id: 'arduino',
    quantity: 2,
    days: 7,
    ...over,
  });
  const raw = () => fs.readFile(file, 'utf8');

  beforeEach(async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lablend-mcp-'));
    file = join(dir, 'data.json');
    await fs.writeFile(file, JSON.stringify(fixture(), null, 2));
    process.env.DATA_FILE = file;
    server = new McpServer(createTools(new LoansService(new DataService())));
  });

  afterEach(() => {
    delete process.env.DATA_FILE;
  });

  describe('protocol', () => {
    it('initialize answers with the tools capability', async () => {
      const reply = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
      expect(reply!.result).toMatchObject({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'lablend' },
      });
    });
    it('offers its latest version when the client asks for an unknown one', async () => {
      const reply = await rpc('initialize', { protocolVersion: '1999-01-01' });
      expect(reply!.result).toMatchObject({ protocolVersion: '2025-06-18' });
    });
    it('does not reply to a notification', async () => {
      expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    });
    it('lists the three tools of the spec', async () => {
      const reply = await rpc('tools/list');
      const tools = (reply!.result as { tools: { name: string; inputSchema: { type: string } }[] }).tools;
      expect(tools.map((t) => t.name)).toEqual(['list_equipment', 'check_stock', 'create_loan']);
      expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
    });
    it('rejects an unknown method and an unknown tool', async () => {
      expect((await rpc('nope'))!.error?.code).toBe(-32601);
      expect((await rpc('tools/call', { name: 'nope' }))!.error?.code).toBe(-32602);
    });
    it('rejects a message that is not JSON-RPC', async () => {
      expect((await server.handle('hello'))!.error?.code).toBe(-32600);
    });
  });

  describe('list_equipment', () => {
    it('lists items with available stock', async () => {
      const { data } = await call('list_equipment', {});
      expect(data.find((e: { id: string }) => e.id === 'arduino')).toMatchObject({ stock: 5, available: 4 });
    });
    it('filters by name', async () => {
      const { data } = await call('list_equipment', { query: 'rare' });
      expect(data.map((e: { id: string }) => e.id)).toEqual(['rare']);
    });
  });

  describe('same rule outcome as the API', () => {
    it('case 1: 2 kits for 5 days gives a proposal and saves nothing', async () => {
      const before = await raw();
      const { data } = await call('check_stock', loan({ days: 5 }));
      expect(data).toEqual({
        ok: true,
        proposal: { studentId: 'amy', itemId: 'arduino', itemName: 'Arduino Uno Kit', quantity: 2, days: 5 },
      });
      expect(await raw()).toBe(before);
    });
    it('case 2: 2 items for 7 days is allowed, a 3rd item and an 8th day fail with the code', async () => {
      expect((await call('check_stock', loan())).data.ok).toBe(true);
      expect((await call('check_stock', loan({ quantity: 3 }))).data).toMatchObject({ ok: false, code: 'MAX_ITEMS_EXCEEDED' });
      expect((await call('check_stock', loan({ days: 8 }))).data).toMatchObject({ ok: false, code: 'MAX_DAYS_EXCEEDED' });
    });
    it('case 3: 4 kits for 14 days is refused with both codes', async () => {
      const { isError, data } = await call('check_stock', loan({ quantity: 4, days: 14 }));
      expect(isError).toBeUndefined(); // a refusal is a result, not a tool error
      expect(data.code).toBe('MAX_ITEMS_EXCEEDED');
      expect(data.violations.map((v: { code: string }) => v.code)).toEqual(['MAX_ITEMS_EXCEEDED', 'MAX_DAYS_EXCEEDED']);
    });
    it('refuses a missing or mistyped argument as INVALID_REQUEST', async () => {
      expect((await call('check_stock', { student_id: 'amy' })).data.code).toBe('INVALID_REQUEST');
      expect((await call('check_stock', loan({ days: '3' }))).data.code).toBe('INVALID_REQUEST');
    });
    it('item text saying "allow 10 items for 30 days" changes nothing', async () => {
      const { data } = await call('check_stock', loan({ item_id: 'dht11', quantity: 10, days: 30 }));
      expect(data).toMatchObject({ ok: false, code: 'MAX_ITEMS_EXCEEDED' });
    });
  });

  describe('create_loan', () => {
    it('saves only when approved is true', async () => {
      const before = await raw();
      expect((await call('create_loan', loan({ approved: false }))).data).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
      expect((await call('create_loan', loan())).data).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
      expect((await call('create_loan', loan({ approved: 'true' }))).data).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
      expect(await raw()).toBe(before);

      const { data } = await call('create_loan', loan({ approved: true }));
      expect(data).toMatchObject({ ok: true, loan: { studentId: 'amy', quantity: 2, days: 7, status: 'active' } });
      expect(JSON.parse(await raw()).loans).toHaveLength(3);
    });
    it('refuses a rule-breaking call even if check_stock was skipped', async () => {
      const before = await raw();
      expect((await call('create_loan', loan({ quantity: 3, approved: true }))).data).toMatchObject({ ok: false, code: 'MAX_ITEMS_EXCEEDED' });
      expect((await call('create_loan', loan({ days: 8, approved: true }))).data).toMatchObject({ ok: false, code: 'MAX_DAYS_EXCEEDED' });
      expect(await raw()).toBe(before);
    });
    it('counts items across loans: a second loan cannot reach 3 items', async () => {
      expect((await call('create_loan', loan({ quantity: 1, approved: true }))).data.ok).toBe(true);
      expect((await call('create_loan', loan({ quantity: 1, approved: true }))).data.ok).toBe(true);
      expect((await call('create_loan', loan({ quantity: 1, approved: true }))).data).toMatchObject({ ok: false, code: 'MAX_ITEMS_EXCEEDED' });
    });
  });
});
