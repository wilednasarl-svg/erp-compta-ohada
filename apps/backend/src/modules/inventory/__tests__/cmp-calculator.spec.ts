import {
  applyAdjustment,
  applyInventoryCount,
  applyPurchase,
  applySale,
  replayHistory,
} from '../services/cmp-calculator';

describe('CmpCalculator', () => {
  // ─── applyPurchase ──────────────────────────────────────────────────

  describe('applyPurchase — repondération CMP', () => {
    it('first purchase: new CMP = unitPrice', () => {
      const result = applyPurchase({ qty: 0, cmp: 0 }, { qty: 100, unitPrice: 10 });
      expect(result.qty).toBe('100.0000');
      expect(result.cmp).toBe('10.0000');
      expect(result.movementValue).toBe('1000.00');
    });

    it('weighted average: 50 @ 10 + 50 @ 20 = 100 @ 15', () => {
      const result = applyPurchase({ qty: 50, cmp: 10 }, { qty: 50, unitPrice: 20 });
      expect(result.qty).toBe('100.0000');
      expect(result.cmp).toBe('15.0000');
      expect(result.movementValue).toBe('1000.00');
    });

    it('uneven weighting: 30 @ 10 + 70 @ 20 = 100 @ 17', () => {
      const result = applyPurchase({ qty: 30, cmp: 10 }, { qty: 70, unitPrice: 20 });
      expect(result.qty).toBe('100.0000');
      expect(result.cmp).toBe('17.0000');
    });

    it('handles fractional quantities (matières au kg)', () => {
      const result = applyPurchase({ qty: 12.5, cmp: 100 }, { qty: 7.5, unitPrice: 200 });
      // CMP = (12.5*100 + 7.5*200) / 20 = (1250 + 1500) / 20 = 137.5
      expect(result.qty).toBe('20.0000');
      expect(result.cmp).toBe('137.5000');
    });

    it('rejects qty <= 0', () => {
      expect(() => applyPurchase({ qty: 0, cmp: 0 }, { qty: 0, unitPrice: 10 })).toThrow(
        /qty must be > 0/,
      );
      expect(() => applyPurchase({ qty: 0, cmp: 0 }, { qty: -5, unitPrice: 10 })).toThrow();
    });

    it('rejects negative unitPrice', () => {
      expect(() => applyPurchase({ qty: 0, cmp: 0 }, { qty: 10, unitPrice: -1 })).toThrow(
        /cannot be negative/,
      );
    });

    it('accepts unitPrice = 0 (gratuit / échantillon)', () => {
      const result = applyPurchase({ qty: 100, cmp: 10 }, { qty: 10, unitPrice: 0 });
      // CMP becomes (100*10 + 10*0) / 110 = 1000/110 ≈ 9.0909
      expect(Number(result.cmp)).toBeCloseTo(9.0909, 3);
    });
  });

  // ─── applySale ──────────────────────────────────────────────────────

  describe('applySale — CMP inchangé', () => {
    it('sale does not change CMP', () => {
      const result = applySale({ qty: 100, cmp: 15 }, { qty: 30 });
      expect(result.qty).toBe('70.0000');
      expect(result.cmp).toBe('15.0000');
      expect(result.movementValue).toBe('-450.00'); // -30 × 15
    });

    it('partial sale of full stock', () => {
      const result = applySale({ qty: 50, cmp: 100 }, { qty: 50 });
      expect(result.qty).toBe('0.0000');
      expect(result.cmp).toBe('100.0000'); // CMP preserved even at zero stock
      expect(result.movementValue).toBe('-5000.00');
    });

    it('rejects sale exceeding stock', () => {
      expect(() => applySale({ qty: 10, cmp: 5 }, { qty: 11 })).toThrow(/exceeds available stock/);
    });

    it('tolerates floating-point qty within 1e-9', () => {
      // 10.0000000001 should not throw if stock is 10
      const result = applySale({ qty: 10, cmp: 5 }, { qty: 10 });
      expect(result.qty).toBe('0.0000');
    });

    it('rejects qty <= 0', () => {
      expect(() => applySale({ qty: 100, cmp: 5 }, { qty: 0 })).toThrow();
      expect(() => applySale({ qty: 100, cmp: 5 }, { qty: -1 })).toThrow();
    });
  });

  // ─── applyAdjustment ────────────────────────────────────────────────

  describe('applyAdjustment', () => {
    it('positive deltaQty acts as purchase', () => {
      const result = applyAdjustment(
        { qty: 100, cmp: 10 },
        { deltaQty: 50, unitPrice: 20 },
      );
      expect(result.qty).toBe('150.0000');
      expect(Number(result.cmp)).toBeCloseTo(13.3333, 3);
    });

    it('negative deltaQty acts as sale at current CMP', () => {
      const result = applyAdjustment({ qty: 100, cmp: 10 }, { deltaQty: -30 });
      expect(result.qty).toBe('70.0000');
      expect(result.cmp).toBe('10.0000');
      expect(result.movementValue).toBe('-300.00');
    });

    it('rejects deltaQty = 0', () => {
      expect(() => applyAdjustment({ qty: 100, cmp: 10 }, { deltaQty: 0 })).toThrow();
    });

    it('rejects positive delta without unitPrice', () => {
      expect(() => applyAdjustment({ qty: 0, cmp: 0 }, { deltaQty: 10 })).toThrow(
        /requires a unitPrice/,
      );
    });

    it('rejects negative delta exceeding stock', () => {
      expect(() => applyAdjustment({ qty: 5, cmp: 10 }, { deltaQty: -10 })).toThrow();
    });
  });

  // ─── applyInventoryCount ────────────────────────────────────────────

  describe('applyInventoryCount — autorité physique', () => {
    it('physical = current → no-op', () => {
      const result = applyInventoryCount({ qty: 100, cmp: 15 }, { physicalQty: 100 });
      expect(result.qty).toBe('100.0000');
      expect(result.cmp).toBe('15.0000');
      expect(result.movementValue).toBe('0.00');
    });

    it('physical > current → écart valued at current CMP', () => {
      const result = applyInventoryCount({ qty: 100, cmp: 10 }, { physicalQty: 105 });
      expect(result.qty).toBe('105.0000');
      expect(result.cmp).toBe('10.0000'); // unchanged
      expect(result.movementValue).toBe('50.00'); // +5 × 10
    });

    it('physical < current → perte valued at current CMP', () => {
      const result = applyInventoryCount({ qty: 100, cmp: 10 }, { physicalQty: 95 });
      expect(result.qty).toBe('95.0000');
      expect(result.movementValue).toBe('-50.00');
    });

    it('rejects negative physicalQty', () => {
      expect(() => applyInventoryCount({ qty: 100, cmp: 10 }, { physicalQty: -1 })).toThrow();
    });
  });

  // ─── replayHistory ──────────────────────────────────────────────────

  describe('replayHistory — composition', () => {
    it('5 purchases + 2 sales reproduce expected state', () => {
      const result = replayHistory(
        { qty: 0, cmp: 0 },
        [
          { type: 'purchase', qty: 100, unitPrice: 10 },  // 100 @ 10
          { type: 'purchase', qty: 100, unitPrice: 20 },  // 200 @ 15
          { type: 'sale', qty: 50 },                      // 150 @ 15
          { type: 'purchase', qty: 50, unitPrice: 18 },   // 200 @ 15.75
          { type: 'sale', qty: 100 },                     // 100 @ 15.75
        ],
      );
      expect(result.qty).toBe('100.0000');
      expect(Number(result.cmp)).toBeCloseTo(15.75, 4);
    });

    it('inventory_count overrides historical drift', () => {
      const result = replayHistory(
        { qty: 0, cmp: 0 },
        [
          { type: 'purchase', qty: 100, unitPrice: 10 },
          { type: 'inventory_count', qty: 90 }, // 10 lost
        ],
      );
      expect(result.qty).toBe('90.0000');
      expect(result.cmp).toBe('10.0000');
    });

    it('empty history returns initial state rounded', () => {
      const result = replayHistory({ qty: 50, cmp: 12.3456789 }, []);
      expect(result.qty).toBe('50.0000');
      expect(result.cmp).toBe('12.3457'); // half-away rounding
    });

    it('throws on purchase entry missing unitPrice', () => {
      expect(() =>
        replayHistory({ qty: 0, cmp: 0 }, [{ type: 'purchase', qty: 10 }]),
      ).toThrow(/requires unitPrice/);
    });
  });

  // ─── invariants ─────────────────────────────────────────────────────

  describe('invariants', () => {
    it('CMP never changes on sale (proven by many scenarios)', () => {
      const initialCmp = 12.3456;
      for (const sellQty of [1, 10, 50, 99.9999]) {
        const result = applySale({ qty: 100, cmp: initialCmp }, { qty: sellQty });
        expect(Number(result.cmp)).toBeCloseTo(initialCmp, 4);
      }
    });

    it('CMP after purchase is between previous CMP and new unitPrice', () => {
      const result = applyPurchase({ qty: 50, cmp: 10 }, { qty: 50, unitPrice: 20 });
      const cmpN = Number(result.cmp);
      expect(cmpN).toBeGreaterThan(10);
      expect(cmpN).toBeLessThan(20);
    });

    it('total stock value is conserved across a purchase', () => {
      // value_before = 50 × 10 = 500
      // value_added  = 50 × 20 = 1000
      // value_after  = 100 × cmp_after must equal 1500
      const result = applyPurchase({ qty: 50, cmp: 10 }, { qty: 50, unitPrice: 20 });
      expect(Number(result.qty) * Number(result.cmp)).toBeCloseTo(1500, 2);
    });
  });
});
