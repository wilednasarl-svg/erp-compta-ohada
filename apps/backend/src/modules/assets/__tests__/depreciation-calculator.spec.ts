import {
  computeDecliningSchedule,
  computeDerogatorySchedule,
  computeLinearSchedule,
  computeSchedule,
  computeSoftySchedule,
  computeUnitsOfProductionSchedule,
  DerogatoryConfigInvalidError,
  UopUnitsOverflowError,
  UopUnitsRequiredError,
} from '../services/depreciation-calculator';

describe('DepreciationCalculator', () => {
  describe('linear — invariants', () => {
    it('sum of dotations equals (cost - residual) exactly', () => {
      const lines = computeLinearSchedule({
        acquisitionCost: 12000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 60,
        method: 'linear',
      });
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(12000, 2);
    });

    it('residual value is preserved as final NBV', () => {
      const lines = computeLinearSchedule({
        acquisitionCost: 50000,
        residualValue: 5000,
        putInServiceDate: '2026-01-01',
        durationMonths: 48,
        method: 'linear',
      });
      const finalNbv = Number(lines[lines.length - 1].netBookValue);
      expect(finalNbv).toBeCloseTo(5000, 2);
    });

    it('cumulative depreciation is monotonically increasing', () => {
      const lines = computeLinearSchedule({
        acquisitionCost: 100000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 120,
        method: 'linear',
      });
      let prev = -1;
      for (const l of lines) {
        const c = Number(l.cumulativeDepreciation);
        expect(c).toBeGreaterThanOrEqual(prev);
        prev = c;
      }
    });
  });

  describe('linear — full-year case (no proration)', () => {
    it('5 years × 12000/year for a 60-month asset starting 2026-01-01', () => {
      const lines = computeLinearSchedule({
        acquisitionCost: 60000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 60,
        method: 'linear',
      });
      expect(lines).toHaveLength(5); // 2026..2030 (5 years starting 2026-01-01 spans 5 calendar years)
      const fiscalYears = lines.map((l) => l.fiscalYear);
      expect(fiscalYears).toEqual([2026, 2027, 2028, 2029, 2030]);
      for (const l of lines) {
        expect(Number(l.depreciationAmount)).toBeGreaterThan(11900);
        expect(Number(l.depreciationAmount)).toBeLessThan(12100);
      }
    });
  });

  describe('linear — mid-year start (prorata)', () => {
    it('5 years × 12000 starting 2026-07-01 spreads over 6 fiscal years', () => {
      const lines = computeLinearSchedule({
        acquisitionCost: 60000,
        residualValue: 0,
        putInServiceDate: '2026-07-01',
        durationMonths: 60,
        method: 'linear',
      });
      // Spans 2026-07-01 → 2031-06-30 → 6 calendar years.
      expect(lines.map((l) => l.fiscalYear)).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
      // 2026 = ~184 days / total days. Year 1+last ~ half a year each ≈ 6000.
      expect(Number(lines[0].depreciationAmount)).toBeGreaterThan(5500);
      expect(Number(lines[0].depreciationAmount)).toBeLessThan(6500);
      expect(Number(lines[5].depreciationAmount)).toBeGreaterThan(5500);
      expect(Number(lines[5].depreciationAmount)).toBeLessThan(6500);
      // Middle years are full ≈ 12000.
      expect(Number(lines[1].depreciationAmount)).toBeCloseTo(12000, 0);
      expect(Number(lines[3].depreciationAmount)).toBeCloseTo(12000, 0);
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(60000, 2);
    });
  });

  describe('linear — residual value', () => {
    it('depreciable base = cost - residual', () => {
      const lines = computeLinearSchedule({
        acquisitionCost: 50000,
        residualValue: 5000,
        putInServiceDate: '2026-01-01',
        durationMonths: 48,
        method: 'linear',
      });
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(45000, 2);
    });
  });

  describe('linear — rounding', () => {
    it('handles non-round costs without drift (last line absorbs delta)', () => {
      const lines = computeLinearSchedule({
        acquisitionCost: 10000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 36,
        method: 'linear',
      });
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(Math.round(sum * 100)).toBe(10000 * 100);
    });
  });

  describe('linear — validation', () => {
    it('rejects residual >= cost', () => {
      expect(() =>
        computeLinearSchedule({
          acquisitionCost: 1000,
          residualValue: 1000,
          putInServiceDate: '2026-01-01',
          durationMonths: 12,
          method: 'linear',
        }),
      ).toThrow();
    });

    it('rejects durationMonths <= 0', () => {
      expect(() =>
        computeLinearSchedule({
          acquisitionCost: 1000,
          residualValue: 0,
          putInServiceDate: '2026-01-01',
          durationMonths: 0,
          method: 'linear',
        }),
      ).toThrow();
    });

    it('rejects invalid date format', () => {
      expect(() =>
        computeLinearSchedule({
          acquisitionCost: 1000,
          residualValue: 0,
          putInServiceDate: '01-01-2026',
          durationMonths: 12,
          method: 'linear',
        }),
      ).toThrow();
    });
  });

  describe('declining', () => {
    it('first year dotation > linear equivalent', () => {
      const linear = computeLinearSchedule({
        acquisitionCost: 100000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 60,
        method: 'linear',
      });
      const declining = computeDecliningSchedule({
        acquisitionCost: 100000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 60,
        method: 'declining',
        decliningRate: 0.4,
      });
      expect(Number(declining[0].depreciationAmount)).toBeGreaterThan(
        Number(linear[0].depreciationAmount),
      );
    });

    it('switches to linear when linear share > declining share', () => {
      // 40% rate on 100k over 5y: year 1 = 40k, year 2 = 24k, year 3 = 14.4k,
      // year 4 declining = 8.64k vs linear on 21.6k/2y = 10.8k → switch.
      const lines = computeDecliningSchedule({
        acquisitionCost: 100000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 60,
        method: 'declining',
        decliningRate: 0.4,
      });
      expect(lines.length).toBeGreaterThanOrEqual(5);
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(100000, 2);
    });

    it('rejects missing declining rate', () => {
      expect(() =>
        computeDecliningSchedule({
          acquisitionCost: 1000,
          residualValue: 0,
          putInServiceDate: '2026-01-01',
          durationMonths: 12,
          method: 'declining',
          decliningRate: null,
        }),
      ).toThrow();
    });

    it('rejects rate outside (0, 1)', () => {
      for (const r of [0, 1, 1.5, -0.1]) {
        expect(() =>
          computeDecliningSchedule({
            acquisitionCost: 1000,
            residualValue: 0,
            putInServiceDate: '2026-01-01',
            durationMonths: 12,
            method: 'declining',
            decliningRate: r,
          }),
        ).toThrow();
      }
    });
  });

  describe('computeSchedule (dispatch)', () => {
    it('routes linear to linear calculator', () => {
      const direct = computeLinearSchedule({
        acquisitionCost: 1000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 12,
        method: 'linear',
      });
      const dispatched = computeSchedule({
        acquisitionCost: 1000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 12,
        method: 'linear',
      });
      expect(dispatched).toEqual(direct);
    });

    it('routes declining to declining calculator', () => {
      const direct = computeDecliningSchedule({
        acquisitionCost: 1000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 24,
        method: 'declining',
        decliningRate: 0.5,
      });
      const dispatched = computeSchedule({
        acquisitionCost: 1000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 24,
        method: 'declining',
        decliningRate: 0.5,
      });
      expect(dispatched).toEqual(direct);
    });
  });

  // ─── W4.3 — SOFTY (Sum-Of-The-Years' digits) ────────────────────────
  describe('SOFTY — Sum-Of-The-Years digits (W4.3)', () => {
    it('5 ans / 100k → annuités 33333.33, 26666.67, 20000, 13333.33, 6666.67', () => {
      const lines = computeSoftySchedule({
        acquisitionCost: 100000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 60,
        method: 'softy',
      });
      expect(lines).toHaveLength(5);
      expect(Number(lines[0].depreciationAmount)).toBeCloseTo(33333.33, 1);
      expect(Number(lines[1].depreciationAmount)).toBeCloseTo(26666.67, 1);
      expect(Number(lines[2].depreciationAmount)).toBeCloseTo(20000, 1);
      expect(Number(lines[3].depreciationAmount)).toBeCloseTo(13333.33, 1);
      expect(Number(lines[4].depreciationAmount)).toBeCloseTo(6666.67, 1);
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(100000, 2);
    });

    it('respects residual value on SOFTY', () => {
      const lines = computeSoftySchedule({
        acquisitionCost: 50000,
        residualValue: 5000,
        putInServiceDate: '2026-01-01',
        durationMonths: 48,
        method: 'softy',
      });
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(45000, 2);
      expect(Number(lines[lines.length - 1].netBookValue)).toBeCloseTo(5000, 2);
    });

    it('annuities strictly decreasing (full-year start)', () => {
      const lines = computeSoftySchedule({
        acquisitionCost: 60000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 48,
        method: 'softy',
      });
      for (let i = 1; i < lines.length; i++) {
        expect(Number(lines[i].depreciationAmount)).toBeLessThan(
          Number(lines[i - 1].depreciationAmount),
        );
      }
    });

    it('SOFTY mid-year start spreads on N+1 fiscal years', () => {
      const lines = computeSoftySchedule({
        acquisitionCost: 60000,
        residualValue: 0,
        putInServiceDate: '2026-07-01',
        durationMonths: 60,
        method: 'softy',
      });
      expect(lines).toHaveLength(6);
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(60000, 2);
    });
  });

  // ─── W4.3 — UOP (units of production) ────────────────────────────────
  describe('UOP — units of production (W4.3)', () => {
    it('totalUnits=10000, unitsPerYear=[3000,2500,2500,2000], 100k → 30k, 25k, 25k, 20k', () => {
      const lines = computeUnitsOfProductionSchedule({
        acquisitionCost: 100000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 48,
        method: 'units_of_production',
        totalUnits: 10000,
        unitsPerYear: [3000, 2500, 2500, 2000],
      });
      expect(lines).toHaveLength(4);
      expect(Number(lines[0].depreciationAmount)).toBeCloseTo(30000, 2);
      expect(Number(lines[1].depreciationAmount)).toBeCloseTo(25000, 2);
      expect(Number(lines[2].depreciationAmount)).toBeCloseTo(25000, 2);
      expect(Number(lines[3].depreciationAmount)).toBeCloseTo(20000, 2);
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(100000, 2);
    });

    it('throws ASSET_UOP_UNITS_OVERFLOW when sum(units) > totalUnits', () => {
      let thrown = null;
      try {
        computeUnitsOfProductionSchedule({
          acquisitionCost: 100000,
          residualValue: 0,
          putInServiceDate: '2026-01-01',
          durationMonths: 48,
          method: 'units_of_production',
          totalUnits: 5000,
          unitsPerYear: [3000, 3000, 2000],
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(UopUnitsOverflowError);
      expect((thrown as UopUnitsOverflowError).code).toBe('ASSET_UOP_UNITS_OVERFLOW');
    });

    it('throws ASSET_UOP_UNITS_REQUIRED when totalUnits/unitsPerYear missing', () => {
      expect(() =>
        computeUnitsOfProductionSchedule({
          acquisitionCost: 100000,
          residualValue: 0,
          putInServiceDate: '2026-01-01',
          durationMonths: 48,
          method: 'units_of_production',
          totalUnits: 0,
          unitsPerYear: [],
        }),
      ).toThrow(UopUnitsRequiredError);
    });

    it('partial usage (sum < total) keeps VNC > residual on last line', () => {
      const lines = computeUnitsOfProductionSchedule({
        acquisitionCost: 100000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 48,
        method: 'units_of_production',
        totalUnits: 10000,
        unitsPerYear: [2000, 2000],
      });
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(40000, 2);
      expect(Number(lines[lines.length - 1].netBookValue)).toBeCloseTo(60000, 2);
    });
  });

  // ─── W4.3 — Amortissements dérogatoires (R34) ────────────────────────
  describe('Dérogatoire — linéaire économique vs dégressif fiscal (W4.3)', () => {
    it('dotation positive en début, reprise en fin (somme nette ≈ 0)', () => {
      const entries = computeDerogatorySchedule({
        acquisitionCost: 100000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 60,
        derogatory: {
          enabled: true,
          economicMethod: 'linear',
          fiscalMethod: 'declining',
          fiscalDecliningRate: 0.4,
        },
      });
      // 5 fiscal years — la linéaire 5 ans démarrée le 01/01 applique
      // un prorata jour exact (365/1826 ≈ 19989 €), tolérance large.
      expect(entries.length).toBe(5);
      expect(Number(entries[0].economicAmount)).toBeGreaterThan(19000);
      expect(Number(entries[0].economicAmount)).toBeLessThan(21000);
      expect(Number(entries[0].fiscalAmount)).toBeGreaterThan(39000);
      expect(Number(entries[0].fiscalAmount)).toBeLessThan(41000);
      expect(Number(entries[0].dotationAmount)).toBeGreaterThan(18000);
      expect(Number(entries[0].repriseAmount)).toBeCloseTo(0, 1);
      expect(Number(entries[1].dotationAmount)).toBeGreaterThan(3000);

      const totalDot = entries.reduce((s, e) => s + Number(e.dotationAmount), 0);
      const totalRep = entries.reduce((s, e) => s + Number(e.repriseAmount), 0);
      expect(totalDot - totalRep).toBeCloseTo(0, 0);
    });

    it('reprise détectée quand fiscal < économique en fin de vie', () => {
      const entries = computeDerogatorySchedule({
        acquisitionCost: 100000,
        residualValue: 0,
        putInServiceDate: '2026-01-01',
        durationMonths: 60,
        derogatory: {
          enabled: true,
          economicMethod: 'linear',
          fiscalMethod: 'declining',
          fiscalDecliningRate: 0.4,
        },
      });
      const hasReprise = entries.some((e) => Number(e.repriseAmount) > 0);
      expect(hasReprise).toBe(true);
    });

    it('rejette fiscal=declining sans fiscalDecliningRate', () => {
      expect(() =>
        computeDerogatorySchedule({
          acquisitionCost: 100000,
          residualValue: 0,
          putInServiceDate: '2026-01-01',
          durationMonths: 60,
          derogatory: {
            enabled: true,
            economicMethod: 'linear',
            fiscalMethod: 'declining',
          },
        }),
      ).toThrow(DerogatoryConfigInvalidError);
    });
  });

  describe('offset fiscal year (e.g. July-June)', () => {
    it('respects custom firstFiscalYearStart/End bounds', () => {
      const lines = computeLinearSchedule({
        acquisitionCost: 60000,
        residualValue: 0,
        putInServiceDate: '2026-09-15',
        durationMonths: 36,
        method: 'linear',
        firstFiscalYearStart: '2026-07-01',
        firstFiscalYearEnd: '2027-06-30',
      });
      expect(lines[0].periodStart).toBe('2026-07-01');
      expect(lines[0].periodEnd).toBe('2027-06-30');
      expect(lines[1].periodStart).toBe('2027-07-01');
      const sum = lines.reduce((s, l) => s + Number(l.depreciationAmount), 0);
      expect(sum).toBeCloseTo(60000, 2);
    });
  });
});
