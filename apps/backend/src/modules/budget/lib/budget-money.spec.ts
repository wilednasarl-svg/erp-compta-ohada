import {
  centsToAmount,
  percentOf,
  subtractAmounts,
  sumAmounts,
  toBaseAmount,
} from './budget-money';

describe('budget-money', () => {
  describe('toBaseAmount', () => {
    it('returns the amount unchanged when rate is 1', () => {
      expect(toBaseAmount('1500000.00', '1')).toBe('1500000.00');
    });

    it('converts a foreign amount at a 6-decimal rate (half-up rounding)', () => {
      // 1000.00 EUR × 655.957000 = 655957.00 XOF
      expect(toBaseAmount('1000.00', '655.957')).toBe('655957.00');
    });

    it('rounds half-up to 2 decimals', () => {
      // 10.00 × 1.005 = 10.05 ; 10.00 × 1.004999 ≈ 10.05 (4.99 rounds up at .5)
      expect(toBaseAmount('10.00', '1.005')).toBe('10.05');
    });

    it('handles negative amounts (treasury outflows)', () => {
      expect(toBaseAmount('-12000000.00', '1')).toBe('-12000000.00');
    });
  });

  describe('sumAmounts / subtractAmounts', () => {
    it('sums signed amounts without float drift', () => {
      expect(sumAmounts(['0.10', '0.20'])).toBe('0.30');
      expect(sumAmounts(['1000000.55', '-500000.55'])).toBe('500000.00');
    });

    it('computes a signed variance', () => {
      expect(subtractAmounts('1620000.00', '1500000.00')).toBe('120000.00');
      expect(subtractAmounts('1400000.00', '1500000.00')).toBe('-100000.00');
    });
  });

  describe('percentOf', () => {
    it('returns null when the base is zero', () => {
      expect(percentOf('120000.00', '0.00')).toBeNull();
    });

    it('computes percentage to one decimal', () => {
      expect(percentOf('120000.00', '1500000.00')).toBe(8);
      expect(percentOf('1620000.00', '1500000.00')).toBe(108);
    });
  });

  describe('centsToAmount', () => {
    it('formats negative cents with sign', () => {
      expect(centsToAmount(-5n)).toBe('-0.05');
      expect(centsToAmount(150000000n)).toBe('1500000.00');
    });
  });
});
