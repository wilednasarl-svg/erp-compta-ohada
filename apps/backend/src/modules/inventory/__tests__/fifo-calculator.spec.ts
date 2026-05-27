import { consumeFromLots, type FifoLot } from '../services/fifo-calculator';

describe('FifoCalculator', () => {
  describe('consumeFromLots', () => {
    it('consumes 50 from queue [30 @ 100, 100 @ 110]', () => {
      const lots: FifoLot[] = [
        { id: 'lot-1', remainingQty: 30, unitCost: 100 },
        { id: 'lot-2', remainingQty: 100, unitCost: 110 },
      ];
      const result = consumeFromLots(lots, 50);

      expect(result.consumed).toHaveLength(2);
      expect(result.consumed[0]).toEqual({
        lotId: 'lot-1',
        qty: '30.0000',
        unitCost: '100.0000',
      });
      expect(result.consumed[1]).toEqual({
        lotId: 'lot-2',
        qty: '20.0000',
        unitCost: '110.0000',
      });
      // 30 × 100 + 20 × 110 = 3000 + 2200 = 5200
      expect(result.totalCost).toBe('5200.00');
      expect(result.remainingShortage).toBe('0.0000');
    });

    it('reports shortage when queue is insufficient (request 200 from [30, 100])', () => {
      const lots: FifoLot[] = [
        { id: 'lot-1', remainingQty: 30, unitCost: 100 },
        { id: 'lot-2', remainingQty: 100, unitCost: 110 },
      ];
      const result = consumeFromLots(lots, 200);

      // 30 × 100 + 100 × 110 = 3000 + 11000 = 14000
      expect(result.totalCost).toBe('14000.00');
      expect(result.remainingShortage).toBe('70.0000');
      expect(result.consumed).toHaveLength(2);
    });

    it('empty queue → totalCost=0, remainingShortage=requested', () => {
      const result = consumeFromLots([], 50);
      expect(result.consumed).toEqual([]);
      expect(result.totalCost).toBe('0.00');
      expect(result.remainingShortage).toBe('50.0000');
    });

    it('requested qty 0 → no-op', () => {
      const lots: FifoLot[] = [{ id: 'lot-1', remainingQty: 100, unitCost: 50 }];
      const result = consumeFromLots(lots, 0);
      expect(result.consumed).toEqual([]);
      expect(result.totalCost).toBe('0.00');
      expect(result.remainingShortage).toBe('0.0000');
    });

    it('skips lots with remainingQty = 0', () => {
      const lots: FifoLot[] = [
        { id: 'lot-empty', remainingQty: 0, unitCost: 50 },
        { id: 'lot-1', remainingQty: 20, unitCost: 100 },
      ];
      const result = consumeFromLots(lots, 10);
      expect(result.consumed).toHaveLength(1);
      expect(result.consumed[0].lotId).toBe('lot-1');
      expect(result.totalCost).toBe('1000.00');
    });

    it('rejects negative requested qty', () => {
      expect(() => consumeFromLots([], -5)).toThrow(/cannot be negative/);
    });

    it('exact match consumes whole queue', () => {
      const lots: FifoLot[] = [
        { id: 'lot-1', remainingQty: 30, unitCost: 100 },
        { id: 'lot-2', remainingQty: 70, unitCost: 110 },
      ];
      const result = consumeFromLots(lots, 100);
      expect(result.remainingShortage).toBe('0.0000');
      // 30 × 100 + 70 × 110 = 3000 + 7700 = 10700
      expect(result.totalCost).toBe('10700.00');
    });

    it('handles fractional quantities (matières au kg)', () => {
      const lots: FifoLot[] = [
        { id: 'lot-1', remainingQty: 12.5, unitCost: 100 },
        { id: 'lot-2', remainingQty: 7.5, unitCost: 200 },
      ];
      const result = consumeFromLots(lots, 15);
      // 12.5 × 100 + 2.5 × 200 = 1250 + 500 = 1750
      expect(result.totalCost).toBe('1750.00');
      expect(result.remainingShortage).toBe('0.0000');
    });
  });
});
