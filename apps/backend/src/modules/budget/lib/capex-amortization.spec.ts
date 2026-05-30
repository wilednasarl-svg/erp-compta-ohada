import { annualDotation, computeMonthlyDotations } from './capex-amortization';

describe('capex-amortization', () => {
  it('génère 12 dotations mensuelles pour un exercice plein', () => {
    // 12 000 000 sur 3 ans = 4 000 000/an = 333 333,33/mois
    const d = computeMonthlyDotations({
      amount: '12000000.00',
      durationYears: 3,
      serviceYear: 2026,
      serviceMonth: 1,
      exerciseYear: 2026,
    });
    expect(d).toHaveLength(12);
    expect(d[0]).toEqual({ periodMonth: 1, amount: '333333.33' });
    expect(
      annualDotation({
        amount: '12000000.00',
        durationYears: 3,
        serviceYear: 2026,
        serviceMonth: 1,
        exerciseYear: 2026,
      }),
    ).toBe('3999999.96'); // 12 × 333333.33 (arrondi mensuel)
  });

  it('prorata temporis : mise en service en avril → 9 dotations', () => {
    const d = computeMonthlyDotations({
      amount: '12000000.00',
      durationYears: 3,
      serviceYear: 2026,
      serviceMonth: 4,
      exerciseYear: 2026,
    });
    expect(d.map((x) => x.periodMonth)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('exercice antérieur à la mise en service → aucune dotation', () => {
    expect(
      computeMonthlyDotations({
        amount: '12000000.00',
        durationYears: 3,
        serviceYear: 2026,
        serviceMonth: 4,
        exerciseYear: 2025,
      }),
    ).toHaveLength(0);
  });

  it('exercice après la fin de l’amortissement → aucune dotation', () => {
    // service 01/2026, durée 3 ans → fin 12/2028 ; 2030 = rien
    expect(
      computeMonthlyDotations({
        amount: '12000000.00',
        durationYears: 3,
        serviceYear: 2026,
        serviceMonth: 1,
        exerciseYear: 2030,
      }),
    ).toHaveLength(0);
  });

  it('dernier exercice partiel : service 04/2026 durée 3 ans → 2029 a 3 mois (jan-mar)', () => {
    const d = computeMonthlyDotations({
      amount: '12000000.00',
      durationYears: 3,
      serviceYear: 2026,
      serviceMonth: 4,
      exerciseYear: 2029,
    });
    expect(d.map((x) => x.periodMonth)).toEqual([1, 2, 3]);
  });
});
