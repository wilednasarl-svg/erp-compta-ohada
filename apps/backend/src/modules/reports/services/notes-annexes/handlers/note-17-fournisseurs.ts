/**
 * Note 17 — Fournisseurs d'exploitation.
 *
 * Ventilation des comptes fournisseurs à la clôture :
 *   - 401 : Fournisseurs (principal)
 *   - 402 : Fournisseurs effets à payer
 *   - 408 : Fournisseurs — factures non parvenues (FNP)
 *   - 409 : Fournisseurs débiteurs / avances versées (à montrer à part)
 *
 * Source : `ReportsRepository.accountBalancesAsAt`. Les comptes 40x ont
 * une nature créditrice ; on affiche le solde en `credit` (positif).
 */

import type { NoteHandler, NoteRow } from '../types';

interface Category {
  readonly key: string;
  readonly label: string;
  readonly prefixes: ReadonlyArray<string>;
}

const CATEGORIES: ReadonlyArray<Category> = [
  { key: 'FOURN_PRINCIPAL', label: 'Fournisseurs (401)', prefixes: ['401'] },
  { key: 'FOURN_EFFETS', label: 'Fournisseurs effets à payer (402)', prefixes: ['402'] },
  { key: 'FOURN_FNP', label: 'Fournisseurs — factures non parvenues (408)', prefixes: ['408'] },
  { key: 'FOURN_DEBITEURS', label: 'Fournisseurs débiteurs / avances (409)', prefixes: ['409'] },
];

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export const handleN17Fournisseurs: NoteHandler = async (ctx, deps) => {
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
    label: "TOTAL fournisseurs d'exploitation",
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
