/**
 * Note 31 — Tableau des Flux de Trésorerie (TFT) ventilé.
 *
 * Doctrine SYSCOHADA (Tome 3 — Vol. 3 pages 8-15) : la Note 31 reprend
 * en annexe le TFT calculé par le `CashFlowService` (méthode indirecte)
 * en l'éclatant poste par poste pour traçabilité.
 *
 * Structure du rendu :
 *   1 ligne par poste FA..FQ + sous-totaux (ZA opérationnel,
 *   ZB investissement, ZC financement) + ZD (trésorerie ouverture),
 *   ZG (trésorerie clôture) et ZH (variation totale).
 *
 * Convention `values` :
 *   - `codeRef`          : code SYSCOHADA (FA, ZA, ZD, …)
 *   - `montantN`         : exercice courant (string DECIMAL(15,2))
 *   - `montantPrecedent` : exercice N-1 si comparatif disponible
 *   - `kind`             : 'poste' | 'subtotal' | 'tresorerie' — pour
 *                          que le frontend puisse styliser sans
 *                          re-mapper.
 */

import type { CashFlowReport } from '../../cash-flow.service';
import type { NoteHandler, NoteRow } from '../types';

const ZD_LABEL = 'Trésorerie nette à l’ouverture';
const ZG_LABEL = 'Trésorerie nette à la clôture';
const ZH_LABEL = 'VARIATION DE LA TRÉSORERIE NETTE (ZG − ZD)';

function row(
  key: string,
  label: string,
  codeRef: string,
  montantN: string,
  montantPrecedent: string | null,
  kind: 'poste' | 'subtotal' | 'tresorerie',
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

function pickPreviousSubtotal(
  report: CashFlowReport,
  sectionCode: 'ZA' | 'ZB' | 'ZC',
): string | null {
  if (!report.previous) return null;
  if (sectionCode === 'ZA') return report.previous.operationalFlow;
  if (sectionCode === 'ZB') return report.previous.investmentFlow;
  return report.previous.financingFlow;
}

export const handleN31FluxTresorerie: NoteHandler = async (ctx, deps) => {
  // Pour l'exercice précédent on demande l'année N-1 sur la même
  // amplitude que N. Si `CashFlowService` ne dispose pas d'historique,
  // il renverra simplement `previous: undefined` et le rendu ignorera
  // la colonne `montantPrecedent`.
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

  // ZD — trésorerie ouverture (avant section ZA, comme dans la liasse).
  rows.push(
    row(
      'ZD',
      ZD_LABEL,
      'ZD',
      report.openingCash,
      report.previous?.openingCash ?? null,
      'tresorerie',
    ),
  );

  // Sections ZA, ZB, ZC : on rajoute chaque poste puis le sous-total.
  for (const section of report.sections) {
    const sectionCode = section.code as 'ZA' | 'ZB' | 'ZC';
    for (const poste of section.postes) {
      rows.push(
        row(
          poste.code,
          poste.label,
          poste.code,
          poste.amount,
          // Pas de comparatif par poste : SYSCOHADA n'oblige que les
          // sous-totaux et la trésorerie. On laisse `null` pour
          // signaler "non disponible" au frontend.
          null,
          'poste',
          poste.source,
        ),
      );
    }
    rows.push(
      row(
        sectionCode,
        section.label,
        sectionCode,
        section.subtotal,
        pickPreviousSubtotal(report, sectionCode),
        'subtotal',
      ),
    );
  }

  // ZG — trésorerie clôture.
  rows.push(
    row(
      'ZG',
      ZG_LABEL,
      'ZG',
      report.closingCash,
      report.previous?.closingCash ?? null,
      'tresorerie',
    ),
  );

  // ZH — variation totale (contrôle de cohérence : doit ≈ ZA+ZB+ZC).
  rows.push(
    row(
      'ZH',
      ZH_LABEL,
      'ZH',
      report.netCashVariation,
      report.previous?.netCashVariation ?? null,
      'subtotal',
      `coherenceCheck=${report.coherenceCheck}`,
    ),
  );

  return { rows, applicable: true };
};

/**
 * Retourne la date "YYYY-MM-DD" un an avant la date donnée (même mois,
 * même jour). Utilisée pour demander à `CashFlowService` le comparatif
 * N-1 sur l'exercice précédent (best effort — si l'org n'a pas
 * d'historique, le service renvoie `previous: undefined`).
 */
function previousYearDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** Exposé pour les tests. */
export const __testing = { previousYearDate };
