import { cappedSum, flatContribution, progressiveContribution } from './social-contributions';
import type { TaxBracket } from './progressive-tax';

const SCALE: TaxBracket[] = [
  { fromAmount: '0.00', toAmount: '75000.00', rate: '0.0000' },
  { fromAmount: '75000.00', toAmount: null, rate: '16.0000' },
];

describe('social-contributions', () => {
  describe('cappedSum', () => {
    it('caps each gross at the ceiling before summing', () => {
      // min(100000,70000)+min(200000,70000) = 70000+70000 = 140000
      expect(cappedSum(['100000.00', '200000.00'], '70000.00')).toBe('140000.00');
    });

    it('sums raw grosses when there is no ceiling', () => {
      expect(cappedSum(['100000.00', '200000.00'], null)).toBe('300000.00');
    });

    it('returns 0 for no employees', () => {
      expect(cappedSum([], '70000.00')).toBe('0.00');
    });
  });

  describe('flatContribution', () => {
    it('applies the rate to the per-head capped base', () => {
      // capped 140000 × 5.75% = 8050
      expect(flatContribution(['100000.00', '200000.00'], '5.7500', '70000.00')).toBe('8050.00');
    });
  });

  describe('progressiveContribution', () => {
    it('sums the progressive tax computed PER head (not on the aggregate)', () => {
      // per-head: 16%×25000=4000 ; 16%×225000=36000 → 40000
      expect(progressiveContribution(['100000.00', '300000.00'], SCALE)).toBe('40000.00');
    });

    it('differs from applying the scale on the aggregate (non-additivity)', () => {
      // aggregate 400000 → 16%×325000 = 52000 ; per-head = 40000. Preuve que
      // le calcul par tête est nécessaire.
      const perHead = progressiveContribution(['100000.00', '300000.00'], SCALE);
      const aggregate = progressiveContribution(['400000.00'], SCALE);
      expect(perHead).toBe('40000.00');
      expect(aggregate).toBe('52000.00');
      expect(perHead).not.toBe(aggregate);
    });
  });
});
