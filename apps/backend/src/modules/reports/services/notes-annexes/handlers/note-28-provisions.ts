/**
 * Note 28 — Provisions financières pour risques et charges.
 *
 * Ventilation des comptes 19x à la clôture :
 *   - 191 : Provisions pour litiges
 *   - 192 : Provisions pour garanties données aux clients
 *   - 194 : Provisions pour pertes sur marchés à terme
 *   - 195 : Provisions pour impôts (différés ou litiges fiscaux)
 *   - 197 : Provisions pour charges à répartir sur plusieurs exercices
 *   - 198 : Autres provisions financières pour risques et charges
 *
 * Source : `ReportsRepository.accountBalancesAsAt`. Comptes
 * naturellement créditeurs.
 */

import type { NoteHandler, NoteRow } from '../types';

interface Category {
  readonly key: string;
  readonly label: string;
  readonly prefixes: ReadonlyArray<string>;
}

const CATEGORIES: ReadonlyArray<Category> = [
  { key: 'LITIGES', label: 'Provisions pour litiges (191)', prefixes: ['191'] },
  { key: 'GARANTIES', label: 'Provisions pour garanties clients (192)', prefixes: ['192'] },
  { key: 'PERTES_TERME', label: 'Provisions pour pertes marchés à terme (194)', prefixes: ['194'] },
  { key: 'IMPOTS', label: 'Provisions pour impôts (195)', prefixes: ['195'] },
  { key: 'CHARGES_REP', label: 'Provisions charges à répartir (197)', prefixes: ['197'] },
  { key: 'AUTRES', label: 'Autres provisions financières (198)', prefixes: ['198'] },
];

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export const handleN28Provisions: NoteHandler = async (ctx, deps) => {
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
        provision: fmt(credit), // montant provisionné = côté créditeur
      },
    };
  });

  rows.push({
    key: 'TOTAL',
    label: 'TOTAL provisions financières pour risques et charges',
    values: {
      debit: fmt(grandDebit),
      credit: fmt(grandCredit),
      provision: fmt(grandCredit),
    },
  });

  const hasAny = rows.some((r) => r.key !== 'TOTAL' && num(r.values.provision) > 0);

  return { rows, applicable: hasAny };
};
