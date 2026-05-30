import { computeProgressiveTax, type TaxBracket } from './progressive-tax';

const SCALE: TaxBracket[] = [
  { fromAmount: '0.00', toAmount: '75000.00', rate: '0.0000' },
  { fromAmount: '75000.00', toAmount: '240000.00', rate: '16.0000' },
  { fromAmount: '240000.00', toAmount: '800000.00', rate: '21.0000' },
  { fromAmount: '800000.00', toAmount: null, rate: '24.0000' },
];

describe('computeProgressiveTax', () => {
  it('returns 0 within the exempt bracket', () => {
    expect(computeProgressiveTax('50000.00', SCALE)).toBe('0.00');
  });

  it('taxes only the portion above the threshold', () => {
    // 16% × (100000 − 75000) = 4 000
    expect(computeProgressiveTax('100000.00', SCALE)).toBe('4000.00');
  });

  it('sums across multiple brackets', () => {
    // 0%×75k + 16%×165k + 21%×60k = 26 400 + 12 600 = 39 000
    expect(computeProgressiveTax('300000.00', SCALE)).toBe('39000.00');
  });

  it('handles the open top bracket', () => {
    // 0 + 16%×165k(26 400) + 21%×560k(117 600) + 24%×200k(48 000) = 192 000
    expect(computeProgressiveTax('1000000.00', SCALE)).toBe('192000.00');
  });

  it('returns 0 for a non-positive base', () => {
    expect(computeProgressiveTax('0.00', SCALE)).toBe('0.00');
    expect(computeProgressiveTax('-5000.00', SCALE)).toBe('0.00');
  });

  it('is order-independent (sorts brackets by lower bound)', () => {
    const shuffled = [...SCALE].reverse();
    expect(computeProgressiveTax('300000.00', shuffled)).toBe('39000.00');
  });
});
