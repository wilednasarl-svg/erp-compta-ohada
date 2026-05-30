import { computeAmountDue, computeDueDate } from './fiscal-calc';

describe('fiscal-calc', () => {
  describe('computeDueDate', () => {
    it('monthly → dueDay of the next month', () => {
      expect(computeDueDate(2026, 3, 'monthly', 15)).toBe('2026-04-15');
    });

    it('monthly December rolls over to January N+1', () => {
      expect(computeDueDate(2026, 12, 'monthly', 15)).toBe('2027-01-15');
    });

    it('annual → April N+1', () => {
      expect(computeDueDate(2026, null, 'annual', 20)).toBe('2027-04-20');
    });

    it('clamps the due day to the last day of the target month', () => {
      // Janvier N+1, dueDay 31 → 31 (janvier a 31 jours)
      expect(computeDueDate(2026, 12, 'monthly', 31)).toBe('2027-01-31');
      // Avril a 30 jours → clamp
      expect(computeDueDate(2026, 3, 'monthly', 31)).toBe('2026-04-30');
    });
  });

  describe('computeAmountDue', () => {
    it('applies a flat percentage rate', () => {
      // 45 000 000 × 18% = 8 100 000
      expect(computeAmountDue('45000000.00', '18.0000')).toBe('8100000.00');
    });

    it('caps the base at the ceiling (CNPS plafond)', () => {
      // base 1 000 000 plafonnée à 70 000 × 5.75% = 4 025
      expect(computeAmountDue('1000000.00', '5.7500', '70000.00')).toBe('4025.00');
    });

    it('rounds half-up to 2 decimals', () => {
      // 333.33 × 0.5% = 1.66665 → 1.67
      expect(computeAmountDue('333.33', '0.5000')).toBe('1.67');
    });

    it('returns 0 for a zero rate (e.g. patente saisie manuelle)', () => {
      expect(computeAmountDue('5000000.00', '0.0000')).toBe('0.00');
    });
  });
});
