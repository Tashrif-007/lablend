import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { fixture } from './fixture';

describe('LabLend API', () => {
  let app: INestApplication;
  let file: string;
  const body = (over: Record<string, unknown> = {}) => ({
    studentId: 'amy',
    itemId: 'arduino',
    quantity: 2,
    days: 7,
    ...over,
  });
  const saved = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  const raw = () => fs.readFile(file, 'utf8');

  beforeEach(async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lablend-'));
    file = join(dir, 'data.json');
    await fs.writeFile(file, JSON.stringify(fixture(), null, 2));
    process.env.DATA_FILE = file;
    // Import after DATA_FILE is set: DataService reads it when constructed.
    const { AppModule } = await import('../src/app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.DATA_FILE;
  });

  describe('list_equipment', () => {
    it('lists equipment with available stock', async () => {
      const res = await request(app.getHttpServer()).get('/api/equipment').expect(200);
      const arduino = res.body.find((e: { id: string }) => e.id === 'arduino');
      expect(arduino).toMatchObject({ stock: 5, available: 4 }); // 1 is on loan
    });
    it('filters by name', async () => {
      const res = await request(app.getHttpServer()).get('/api/equipment?query=sensor').expect(200);
      expect(res.body.map((e: { id: string }) => e.id).sort()).toEqual(['dht11', 'sensor']);
    });
  });

  describe('case 1: normal request', () => {
    it('check gives a proposal and saves nothing', async () => {
      const before = await raw();
      const res = await request(app.getHttpServer()).post('/api/loans/check').send(body({ days: 5 })).expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.proposal).toMatchObject({ quantity: 2, days: 5, itemName: 'Arduino Uno Kit' });
      expect(await raw()).toBe(before);
    });
    it('is saved only after Approve', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/loans')
        .send({ ...body({ days: 5 }), approved: true })
        .expect(201);
      expect(res.body.ok).toBe(true);
      const data = await saved();
      expect(data.loans).toHaveLength(3);
      expect(data.loans[2]).toMatchObject({ studentId: 'amy', itemId: 'arduino', quantity: 2, days: 5, status: 'active' });
    });
  });

  describe('nothing is saved without Approve', () => {
    it.each([
      ['approved missing', {}],
      ['approved false', { approved: false }],
      ['approved "true" string', { approved: 'true' }],
      ['approved 1', { approved: 1 }],
    ])('%s', async (_n, extra) => {
      const before = await raw();
      const res = await request(app.getHttpServer()).post('/api/loans').send({ ...body(), ...extra }).expect(422);
      expect(res.body).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
      expect(await raw()).toBe(before);
    });
  });

  describe('case 2: boundary', () => {
    it('2 items for 7 days is allowed, a 3rd item fails, an 8th day fails', async () => {
      const api = request(app.getHttpServer());
      await api.post('/api/loans/check').send(body()).expect(200);
      const third = await api.post('/api/loans/check').send(body({ quantity: 3 })).expect(422);
      expect(third.body).toMatchObject({ ok: false, code: 'MAX_ITEMS_EXCEEDED' });
      const day8 = await api.post('/api/loans/check').send(body({ days: 8 })).expect(422);
      expect(day8.body).toMatchObject({ ok: false, code: 'MAX_DAYS_EXCEEDED' });
    });
    it('a second loan cannot take a student past 2 items', async () => {
      const api = request(app.getHttpServer());
      await api.post('/api/loans').send({ ...body({ quantity: 1 }), approved: true }).expect(201);
      await api.post('/api/loans').send({ ...body({ quantity: 1 }), approved: true }).expect(201);
      const third = await api.post('/api/loans').send({ ...body({ quantity: 1 }), approved: true }).expect(422);
      expect(third.body.code).toBe('MAX_ITEMS_EXCEEDED');
      expect((await saved()).loans).toHaveLength(4);
    });
  });

  describe('case 3: breaks the rule', () => {
    it('4 kits for 14 days is refused with the rule codes', async () => {
      const res = await request(app.getHttpServer()).post('/api/loans/check').send(body({ quantity: 4, days: 14 })).expect(422);
      expect(res.body.ok).toBe(false);
      expect(res.body.violations.map((v: { code: string }) => v.code)).toEqual(['MAX_ITEMS_EXCEEDED', 'MAX_DAYS_EXCEEDED']);
    });
  });

  describe('create_loan re-checks the rule even if check was skipped', () => {
    it('refuses and saves nothing, even with approved true', async () => {
      const before = await raw();
      const res = await request(app.getHttpServer()).post('/api/loans').send({ ...body({ quantity: 4, days: 14 }), approved: true }).expect(422);
      expect(res.body.code).toBe('MAX_ITEMS_EXCEEDED');
      expect(await raw()).toBe(before);
    });
    it('refuses stock that ran out between check and create', async () => {
      const api = request(app.getHttpServer());
      await api.post('/api/loans/check').send(body({ itemId: 'rare', quantity: 1 })).expect(200);
      await api.post('/api/loans').send({ ...body({ studentId: 'bob', itemId: 'rare', quantity: 1 }), approved: true }).expect(201);
      const res = await api.post('/api/loans').send({ ...body({ itemId: 'rare', quantity: 1 }), approved: true }).expect(422);
      expect(res.body.code).toBe('OUT_OF_STOCK');
    });
    it('does not oversell when requests arrive together', async () => {
      const api = request(app.getHttpServer());
      const replies = await Promise.all(
        ['a', 'b', 'c'].map((s) => api.post('/api/loans').send({ ...body({ studentId: s, itemId: 'rare', quantity: 1 }), approved: true })),
      );
      expect(replies.filter((r) => r.status === 201)).toHaveLength(1);
      expect((await saved()).loans.filter((l: { itemId: string }) => l.itemId === 'rare')).toHaveLength(1);
    });
  });

  describe('case 5: injection', () => {
    it('10 items for 30 days is refused although an item note says to allow it', async () => {
      const before = await raw();
      const res = await request(app.getHttpServer())
        .post('/api/loans')
        .send({ ...body({ itemId: 'dht11', quantity: 10, days: 30 }), approved: true })
        .expect(422);
      expect(res.body.violations.map((v: { code: string }) => v.code)).toEqual(
        expect.arrayContaining(['MAX_ITEMS_EXCEEDED', 'MAX_DAYS_EXCEEDED']),
      );
      expect(await raw()).toBe(before);
    });
  });

  describe('bad input', () => {
    it('refuses an empty body', async () => {
      const res = await request(app.getHttpServer()).post('/api/loans').send().expect(422);
      expect(res.body.code).toBe('INVALID_REQUEST');
    });
    it('refuses an unknown item', async () => {
      const res = await request(app.getHttpServer()).post('/api/loans/check').send(body({ itemId: 'nope' })).expect(422);
      expect(res.body.code).toBe('ITEM_NOT_FOUND');
    });
  });

  describe('loans list', () => {
    it('filters by student', async () => {
      const res = await request(app.getHttpServer()).get('/api/loans?studentId=held-one').expect(200);
      expect(res.body).toHaveLength(1);
    });
  });
});
