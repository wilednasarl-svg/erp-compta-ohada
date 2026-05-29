/**
 * Note 31 — Tableau des Flux de Trésorerie (TFT) ventilé.
 *
 * Doctrine SYSCOHADA Révisé Tome 3 page 34 : la Note 31 reprend en
 * annexe le TFT calculé par le `CashFlowService` (méthode indirecte)
 * en l'éclatant poste par poste pour traçabilité.
 *
 * Structure du rendu — strictement conforme à la nomenclature p. 34 :
 *   ZA                       (trésorerie nette au 1er janvier)
 *   FA, FB, FC, FD, FE       (postes opérationnels)
 *   ZB                       (sous-total opérationnel)
 *   FF, FG, FH, FI, FJ       (postes investissement)
 *   ZC                       (sous-total investissement)
 *   FK, FL, FM, FN           (postes financement capitaux propres)
 *   ZD                       (sous-total financement CP)
 *   FO, FP, FQ               (postes financement capitaux étrangers)
 *   ZE                       (sous-total financement CE)
 *   ZF                       (sous-total financement total = ZD + ZE)
 *   ZG                       (variation totale = ZB + ZC + ZF)
 *   ZH                       (trésorerie nette au 31 décembre)
 *
 * Convention `values` :
 *   - `codeRef`          : code SYSCOHADA (FA..FQ, ZA..ZH)
 *   - `montantN`         : exercice courant (string DECIMAL(15,2))
 *   - `montantPrecedent` : exercice N-1 si comparatif disponible
 *   - `kind`             : 'tresorerie' | 'poste' | 'subtotal' | 'total'
 */

import type { CashFlowReport, CashFlowSection } from '../../cash-flow.service';
import type { NoteHandler, NoteRow } from '../types';

const ZA_LABEL = 'Trésorerie nette au 1er janvier';
const ZF_LABEL = 'Flux de trésorerie provenant des activités de financement';
const ZG_LABEL = 'VARIATION DE LA TRÉSORERIE NETTE DE LA PÉRIODE';
const ZH_LABEL = 'Trésorerie nette au 31 décembre';

type RowKind = 'tresorerie' | 'poste' | 'subtotal' | 'total';

function row(
  key: string,
  label: string,
  codeRef: string,
  montantN: string,
  montantPrecedent: string | null,
  kind: RowKind,
  source?: string,
): NoteRow {
  const values: Record<string, string> = {
    codeRef,
    montantN,
    kind,
  };
  if (montantPrecedent !== null) {
    values.montantPrecedent = montantPrecedent;
  }
  if (source !== undefined) {
    values.source = source;
  }
  return { key, label, values };
}

function previousSubtotalFor(
  report: CashFlowReport,
  sectionCode: 'ZB' | 'ZC' | 'ZD' | 'ZE',
): string | null {
  if (!report.previous) return null;
  switch (sectionCode) {
    case 'ZB':
      return report.previous.operatingFlow;
    case 'ZC':
      return report.previous.investingFlow;
    case 'ZD':
      return report.previous.financingFlowEquity;
    case 'ZE':
      return report.previous.financingFlowDebt;
  }
}

function pushSection(
  rows: NoteRow[],
  section: CashFlowSection,
  previousSubtotal: string | null,
): void {
  for (const poste of section.postes) {
    rows.push(row(poste.code, poste.label, poste.code, poste.amount, null, 'poste', poste.source));
  }
  rows.push(
    row(section.code, section.label, section.code, section.subtotal, previousSubtotal, 'subtotal'),
  );
}

export const handleN31FluxTresorerie: NoteHandler = async (ctx, deps) => {
  const previousFromDate = previousYearDate(ctx.periodStart);
  const previousToDate = previousYearDate(ctx.periodEnd);
  const report = await deps.cashFlow.getCashFlow(
    ctx.organizationId,
    ctx.periodStart,
    ctx.periodEnd,
    previousFromDate,
    previousToDate,
  );

  const rows: NoteRow[] = [];

  // ZA — trésorerie nette à l'ouverture (1er janvier)
  rows.push(
    row(
      'ZA',
      ZA_LABEL,
      'ZA',
      report.openingCash,
      report.previous?.openingCash ?? null,
      'tresorerie',
    ),
  );

  // Sections ZB (opérationnel), ZC (investissement), ZD (fin. CP), ZE (fin. CE)
  pushSection(rows, report.operatingFlows, previousSubtotalFor(report, 'ZB'));
  pushSection(rows, report.investingFlows, previousSubtotalFor(report, 'ZC'));
  pushSection(rows, report.financingFlowsEquity, previousSubtotalFor(report, 'ZD'));
  pushSection(rows, report.financingFlowsDebt, previousSubtotalFor(report, 'ZE'));

  // ZF — financement total = ZD + ZE
  rows.push(
    row(
      'ZF',
      ZF_LABEL,
      'ZF',
      report.financingFlowsTotal,
      report.previous?.financingFlowTotal ?? null,
      'subtotal',
    ),
  );

  // ZG — variation totale = ZB + ZC + ZF
  rows.push(
    row(
      'ZG',
      ZG_LABEL,
      'ZG',
      report.netCashVariation,
      report.previous?.netCashVariation ?? null,
      'total',
      `coherenceCheck=${report.coherenceCheck}`,
    ),
  );

  // ZH — trésorerie nette à la clôture (31 décembre) = ZA + ZG
  rows.push(
    row(
      'ZH',
      ZH_LABEL,
      'ZH',
      report.closingCash,
      report.previous?.closingCash ?? null,
      'tresorerie',
    ),
  );

  return { rows, applicable: true };
};

/**
 * Retourne la date "YYYY-MM-DD" un an avant la date donnée. Utilisée
 * pour demander à `CashFlowService` le comparatif N-1 ; si l'org n'a
 * pas d'historique, le service renverra `previous: undefined`.
 */
function previousYearDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** Exposé pour les tests. */
export const __testing = { previousYearDate };
