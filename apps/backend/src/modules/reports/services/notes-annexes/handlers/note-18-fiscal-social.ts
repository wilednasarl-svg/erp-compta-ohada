/**
 * Note 18 — Dettes fiscales et sociales.
 *
 * Ventilation des comptes 43x (sécurité sociale & autres org. sociaux)
 * et 44x (État & collectivités) :
 *   - 431 : Sécurité sociale (CNPS, CMU…)
 *   - 432 : Caisses retraite complémentaire
 *   - 437 : Autres organismes sociaux
 *   - 441 : État — impôt sur les sociétés
 *   - 443 : État — TVA collectée et déductible (solde)
 *   - 447 : État — autres impôts et taxes
 *
 * Source : `ReportsRepository.accountBalancesAsAt`. Comptes
 * naturellement créditeurs ; les soldes débiteurs (acomptes versés)
 * sont normalement présentés à part dans la liasse.
 */

import type { NoteHandler, NoteRow } from '../types';

interface Category {
  readonly key: string;
  readonly label: string;
  readonly prefixes: ReadonlyArray<string>;
}

const CATEGORIES: ReadonlyArray<Category> = [
  { key: 'CNPS', label: 'Sécurité sociale (431)', prefixes: ['431'] },
  { key: 'RETRAITES', label: 'Caisses retraites complémentaires (432)', prefixes: ['432'] },
  { key: 'AUTRES_SOC', label: 'Autres organismes sociaux (437)', prefixes: ['437'] },
  { key: 'IS', label: 'État — impôt sur les sociétés (441)', prefixes: ['441'] },
  { key: 'TVA', label: 'État — TVA (443)', prefixes: ['443'] },
  { key: 'AUTRES_IMP', label: 'État — autres impôts et taxes (447)', prefixes: ['447'] },
];

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export const handleN18FiscalSocial: NoteHandler = async (ctx, deps) => {
  const balances = await deps.reports.accountBalancesAsAt(ctx.organizationId, ctx.periodEnd);

  const totals = new Map<string, number>();
  for (const cat of CATEGORIES) totals.set(cat.key, 0);

  for (const b of balances) {
    const net = num(b.totalDebit) - num(b.totalCredit);
    for (const cat of CATEGORIES) {
      if (cat.prefixes.some((p) => b.accountCode.startsWith(p))) {
        totals.set(cat.key, (totals.get(cat.key) ?? 0) + net);
        break;
      }
    }
  }

  let grandDebit = 0;
  let grandCredit = 0;
  const rows: NoteRow[] = CATEGORIES.map((cat) => {
    const net = totals.get(cat.key) ?? 0;
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    grandDebit += debit;
    grandCredit += credit;
    return {
      key: cat.key,
      label: cat.label,
      values: {
        debit: fmt(debit),
        credit: fmt(credit),
        net: fmt(net),
      },
    };
  });

  rows.push({
    key: 'TOTAL',
    label: 'TOTAL dettes fiscales et sociales',
    values: {
      debit: fmt(grandDebit),
      credit: fmt(grandCredit),
      net: fmt(grandDebit - grandCredit),
    },
  });

  const hasAny = rows.some(
    (r) => r.key !== 'TOTAL' && (num(r.values.debit) > 0 || num(r.values.credit) > 0),
  );

  return { rows, applicable: hasAny };
};
