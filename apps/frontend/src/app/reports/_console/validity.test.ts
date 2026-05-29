import { describe, expect, it } from 'vitest';

import type {
  BalanceSheetReport,
  BilanDiagnosticReport,
  CashFlowReport,
  ComparativeBalanceReport,
  ProfitLossReport,
  SigReport,
  TrialBalanceReport,
} from '@/types/reports';

import {
  validityAsOf,
  validityFromBalanceSheet,
  validityFromBilanDiagnostic,
  validityFromCashFlow,
  validityFromComparativeBalance,
  validityFromProfitLoss,
  validityFromSig,
  validityFromTrialBalance,
} from './validity';

/**
 * Les helpers ne lisent qu'une poignée de champs ; on construit des fixtures
 * minimales castées vers le type complet pour rester lisible.
 */
const as = <T>(partial: unknown): T => partial as T;

describe('validityFromBalanceSheet', () => {
  it('équilibré quand |difference| < 1 FCFA (arrondi/centimes)', () => {
    const v = validityFromBalanceSheet(
      as<BalanceSheetReport>({ asAtDate: '2025-12-31', totals: { actif: '100', passif: '100', difference: '0.4' } }),
    );
    expect(v.imbalance).toBe(0);
    expect(v.lastMovementDate).toBe('2025-12-31');
  });

  it('reporte l’écart arrondi quand le bilan est déséquilibré', () => {
    const v = validityFromBalanceSheet(
      as<BalanceSheetReport>({ asAtDate: '2025-12-31', totals: { actif: '100', passif: '0', difference: '152400.6' } }),
    );
    expect(v.imbalance).toBe(152401);
  });

  it('prend la valeur absolue (écart négatif)', () => {
    const v = validityFromBalanceSheet(
      as<BalanceSheetReport>({ asAtDate: '2025-12-31', totals: { actif: '0', passif: '0', difference: '-500' } }),
    );
    expect(v.imbalance).toBe(500);
  });
});

describe('validityFromTrialBalance & comparative', () => {
  it('balance : écart Σdébit − Σcrédit clôture', () => {
    const v = validityFromTrialBalance(
      as<TrialBalanceReport>({ toDate: '2026-05-29', totals: { endingDebit: '1000', endingCredit: '700' } }),
    );
    expect(v.imbalance).toBe(300);
    expect(v.lastMovementDate).toBe('2026-05-29');
  });

  it('balance équilibrée → imbalance 0', () => {
    const v = validityFromTrialBalance(
      as<TrialBalanceReport>({ toDate: '2026-05-29', totals: { endingDebit: '900', endingCredit: '900' } }),
    );
    expect(v.imbalance).toBe(0);
  });

  it('comparative : même logique d’équilibre clôture', () => {
    const v = validityFromComparativeBalance(
      as<ComparativeBalanceReport>({ toDate: '2026-05-29', totals: { endingDebit: '500', endingCredit: '500' } }),
    );
    expect(v.imbalance).toBe(0);
  });
});

describe('validityFromCashFlow', () => {
  it('expose l’incohérence ZH vs classe 5 comme imbalance', () => {
    const v = validityFromCashFlow(as<CashFlowReport>({ toDate: '2026-05-29', coherenceCheck: '-1200.9' }));
    expect(v.imbalance).toBe(1201);
  });

  it('cohérent (< 1 FCFA) → imbalance 0', () => {
    const v = validityFromCashFlow(as<CashFlowReport>({ toDate: '2026-05-29', coherenceCheck: '0' }));
    expect(v.imbalance).toBe(0);
  });
});

describe('validityFromBilanDiagnostic', () => {
  it('reporte l’écart du journal exposé par le rapport', () => {
    const v = validityFromBilanDiagnostic(
      as<BilanDiagnosticReport>({ asAtDate: '2025-12-31', journal: { imbalance: '8400', totalDebit: '0', totalCredit: '0', isBalanced: false } }),
    );
    expect(v.imbalance).toBe(8400);
    expect(v.lastMovementDate).toBe('2025-12-31');
  });
});

describe('états sans invariant débit=crédit', () => {
  it('compte de résultat : pas d’imbalance, date de fin renseignée', () => {
    const v = validityFromProfitLoss(as<ProfitLossReport>({ toDate: '2026-05-29' }));
    expect(v.imbalance).toBeUndefined();
    expect(v.lastMovementDate).toBe('2026-05-29');
  });

  it('SIG : pas d’imbalance', () => {
    const v = validityFromSig(as<SigReport>({ toDate: '2026-05-29' }));
    expect(v.imbalance).toBeUndefined();
  });

  it('validityAsOf : date fournie, pas d’imbalance, non clôturé', () => {
    const v = validityAsOf('2026-03-31');
    expect(v.imbalance).toBeUndefined();
    expect(v.lastMovementDate).toBe('2026-03-31');
    expect(v.periodClosed).toBe(false);
    expect(typeof v.computedAt).toBe('string');
  });
});
