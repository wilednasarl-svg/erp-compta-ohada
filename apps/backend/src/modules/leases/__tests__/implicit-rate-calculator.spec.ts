import { ERROR_CODES } from '../../../common/errors/error-codes';
import {
  buildAmortizationSchedule,
  findImplicitRate,
  presentValue,
} from '../services/implicit-rate-calculator';
import { periodsPerYear } from '../types/lease.types';

describe('ImplicitRateCalculator', () => {
  describe('presentValue()', () => {
    it('degenerates to installment × periods + option when rate is 0', () => {
      const pv = presentValue(2500, 0, 48, 1000);
      expect(pv).toBeCloseTo(2500 * 48 + 1000, 2);
    });

    it('discounts the option amount at the last period', () => {
      // Sanity check : PV must be < nominal when rate > 0.
      const nominal = 1000 * 12 + 500;
      const pv = presentValue(1000, 0.01, 12, 500);
      expect(pv).toBeLessThan(nominal);
      expect(pv).toBeGreaterThan(0);
    });
  });

  describe('findImplicitRate()', () => {
    it('finds an annual rate close to 9.4 % on a realistic 48-month lease', () => {
      // fairValue=100000, loyer=2500 × 48 + option 1000 → ~9.4 % annuel
      const annualRate = findImplicitRate(100000, 2500, 48, 1000, 'monthly');
      expect(annualRate).toBeGreaterThan(0.08);
      expect(annualRate).toBeLessThan(0.11);

      // Vérification : PV reconstruit doit retomber sur fairValue.
      const periodicRate = annualRate / periodsPerYear('monthly');
      const reconstructed = presentValue(2500, periodicRate, 48, 1000);
      expect(reconstructed).toBeCloseTo(100000, 0);
    });

    it('returns 0 when nominal total equals fair value (no interest)', () => {
      // 1000 × 12 + 0 = 12000 = fair value → taux = 0.
      const rate = findImplicitRate(12000, 1000, 12, 0, 'monthly');
      expect(rate).toBe(0);
    });

    it('throws LEASE_IMPLICIT_RATE_CALCULATION_FAILED when nominal < fair value', () => {
      // 100 × 12 = 1200 < 10000 → aucun taux >= 0 ne peut équilibrer.
      expect(() => findImplicitRate(10000, 100, 12, 0, 'monthly')).toThrow(
        expect.objectContaining({
          code: ERROR_CODES.LEASE_IMPLICIT_RATE_CALCULATION_FAILED,
        }),
      );
    });

    it('throws on invalid parameters (negative fair value)', () => {
      expect(() => findImplicitRate(-1000, 100, 12, 0, 'monthly')).toThrow(
        expect.objectContaining({
          code: ERROR_CODES.LEASE_IMPLICIT_RATE_CALCULATION_FAILED,
        }),
      );
    });
  });

  describe('buildAmortizationSchedule()', () => {
    it('produces N rows that fully amortize the debt (last outstanding = 0)', () => {
      const annualRate = findImplicitRate(100000, 2500, 48, 1000, 'monthly');
      const periodicRate = annualRate / periodsPerYear('monthly');
      const rows = buildAmortizationSchedule(
        100000,
        periodicRate,
        2500,
        48,
        1000,
        'monthly',
        '2026-01-01',
      );

      expect(rows).toHaveLength(48);
      expect(rows[0].installmentNumber).toBe(1);
      expect(rows[47].installmentNumber).toBe(48);
      // Le dernier outstanding doit être 0 (ou très proche).
      expect(rows[47].outstandingBalance).toBeCloseTo(0, 2);
      // La dernière échéance absorbe l'option d'achat.
      expect(rows[47].totalAmount).toBeGreaterThan(2500);
    });

    it('sum of capital parts equals fair value (within rounding tolerance)', () => {
      const annualRate = findImplicitRate(100000, 2500, 48, 1000, 'monthly');
      const periodicRate = annualRate / periodsPerYear('monthly');
      const rows = buildAmortizationSchedule(
        100000,
        periodicRate,
        2500,
        48,
        1000,
        'monthly',
        '2026-01-01',
      );
      const totalCapital = rows.reduce((s, r) => s + r.capitalPart, 0);
      expect(totalCapital).toBeCloseTo(100000, 1);
    });
  });
});
