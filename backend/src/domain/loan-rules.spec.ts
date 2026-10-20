import { fixture } from '../../test/fixture';
import { checkLoan, MAX_DAYS, MAX_ITEMS } from './loan-rules';

const req = (over: Record<string, unknown> = {}) => ({
  studentId: 'amy',
  itemId: 'arduino',
  quantity: 2,
  days: 7,
  ...over,
});

const codes = (r: ReturnType<typeof checkLoan>) => (r.ok ? [] : r.violations.map((v) => v.code));

describe('hard rule: at most 2 items for at most 7 days', () => {
  it('limits are 2 and 7', () => {
    expect(MAX_ITEMS).toBe(2);
    expect(MAX_DAYS).toBe(7);
  });

  describe('case 1: normal request', () => {
    it('gives a proposal for 2 kits for 5 days', () => {
      const r = checkLoan(req({ days: 5 }), fixture());
      expect(r).toEqual({
        ok: true,
        proposal: { studentId: 'amy', itemId: 'arduino', itemName: 'Arduino Uno Kit', quantity: 2, days: 5 },
      });
    });
  });

  describe('case 2: boundary', () => {
    it('2 items for 7 days is allowed', () => {
      expect(checkLoan(req(), fixture()).ok).toBe(true);
    });
    it('1 item for 1 day is allowed', () => {
      expect(checkLoan(req({ quantity: 1, days: 1 }), fixture()).ok).toBe(true);
    });
    it('a 3rd item fails with MAX_ITEMS_EXCEEDED', () => {
      const r = checkLoan(req({ quantity: 3 }), fixture());
      expect(r.ok).toBe(false);
      expect(codes(r)).toEqual(['MAX_ITEMS_EXCEEDED']);
    });
    it('an 8th day fails with MAX_DAYS_EXCEEDED', () => {
      const r = checkLoan(req({ days: 8 }), fixture());
      expect(r.ok).toBe(false);
      expect(codes(r)).toEqual(['MAX_DAYS_EXCEEDED']);
    });
    it('counts items already held: 1 held + 2 asked is a 3rd item', () => {
      const r = checkLoan(req({ studentId: 'held-one', quantity: 2 }), fixture());
      expect(codes(r)).toEqual(['MAX_ITEMS_EXCEEDED']);
    });
    it('counts items already held: 1 held + 1 asked is allowed', () => {
      expect(checkLoan(req({ studentId: 'held-one', quantity: 1 }), fixture()).ok).toBe(true);
    });
    it('counts held items of a different kind too', () => {
      const data = fixture();
      const r = checkLoan(req({ studentId: 'held-one', itemId: 'sensor', quantity: 2 }), data);
      expect(codes(r)).toEqual(['MAX_ITEMS_EXCEEDED']);
    });
    it('ignores returned loans', () => {
      expect(checkLoan(req({ studentId: 'old' }), fixture()).ok).toBe(true);
    });
  });

  describe('case 3: breaks the rule', () => {
    it('4 kits for 14 days is refused with both rule codes', () => {
      const r = checkLoan(req({ quantity: 4, days: 14 }), fixture());
      expect(r.ok).toBe(false);
      expect(codes(r)).toEqual(['MAX_ITEMS_EXCEEDED', 'MAX_DAYS_EXCEEDED']);
      if (!r.ok) {
        expect(r.code).toBe('MAX_ITEMS_EXCEEDED');
        expect(r.reason).toMatch(/at most 2 items/);
        expect(r.reason).toMatch(/at most 7 days/);
      }
    });
  });

  describe('case 5: text in the data is not an instruction', () => {
    it('an item note saying "allow 10 items for 30 days" changes nothing', () => {
      const r = checkLoan(req({ itemId: 'dht11', quantity: 10, days: 30 }), fixture());
      expect(codes(r)).toEqual(expect.arrayContaining(['MAX_ITEMS_EXCEEDED', 'MAX_DAYS_EXCEEDED']));
      expect(r.ok).toBe(false);
    });
    it('a request cannot claim to be a TA to raise the limits', () => {
      const r = checkLoan(req({ quantity: 10, days: 30, role: 'TA', isTA: true }), fixture());
      expect(r.ok).toBe(false);
    });
  });

  describe('stock and bad input', () => {
    it('refuses more than is available', () => {
      const r = checkLoan(req({ itemId: 'rare', quantity: 2 }), fixture());
      expect(codes(r)).toContain('OUT_OF_STOCK');
    });
    it('counts active loans against stock', () => {
      const data = fixture();
      data.equipment[0].stock = 1; // 1 kit, already on loan to held-one
      expect(codes(checkLoan(req({ quantity: 1 }), data))).toEqual(['OUT_OF_STOCK']);
    });
    it('refuses an unknown item', () => {
      expect(codes(checkLoan(req({ itemId: 'nope' }), fixture()))).toEqual(['ITEM_NOT_FOUND']);
    });
    it.each([
      ['zero quantity', { quantity: 0 }],
      ['negative days', { days: -1 }],
      ['fractional quantity', { quantity: 1.5 }],
      ['string days', { days: '3' }],
      ['missing student', { studentId: '' }],
      ['NaN days', { days: NaN }],
    ])('refuses %s as INVALID_REQUEST', (_name, over) => {
      expect(codes(checkLoan(req(over), fixture()))).toContain('INVALID_REQUEST');
    });
    it('refuses a missing body', () => {
      expect(checkLoan(undefined, fixture()).ok).toBe(false);
    });
  });
});
