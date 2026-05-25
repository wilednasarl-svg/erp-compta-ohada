/**
 * Note 7 — Clients et comptes rattachés.
 *
 * Ventilation des comptes clients à la clôture :
 *   - 411 : Clients (principal)
 *   - 412 : Clients groupe
 *   - 414 : Clients EPE
 *   - 416 : Clients douteux ou litigieux
 *   - 418 : Clients - produits non encore facturés
 *   - 419 : Clients créditeurs (avances reçues — affiché à part)
 *
 * Source : `ReportsRepository.accountBalancesAsAt(orgId, periodEnd)`.
 * Le solde affiché est `totalDebit - totalCredit`, conformément à la
 * nature débitrice naturelle des comptes 41x (sauf 419, créditeur).
 */

import type { NoteHandler, NoteRow } from '../types';

interface Category {
  readonly key: string;
  readonly label: string;
  readonly prefixes: ReadonlyArray<string>;
}

const CATEGORIES: ReadonlyArray<Category> = [
  { key: 'CLIENTS_PRINCIPAL', label: 'Clients (411)', prefixes: ['411'] },
  { key: 'CLIENTS_GROUPE', label: 'Clients groupe (412)', prefixes: ['412'] },
  { key: 'CLIENTS_EPE', label: 'Clients EPE (414)', prefixes: ['414'] },
  { key: 'CLIENTS_DOUTEUX', label: 'Clients douteux ou litigieux (416)', prefixes: ['416'] },
  {
    key: 'CLIENTS_PNF',
    label: 'Clients — produits non encore facturés (418)',
    prefixes: ['418'],
  },
  { key: 'CLIENTS_CREDITEURS', label: 'Clients créditeurs / avances (419)', prefixes: ['419'] },
];

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export const handleN7Clients: NoteHandler = async (ctx, deps) => {
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
    label: 'TOTAL clients et comptes rattachés',
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
