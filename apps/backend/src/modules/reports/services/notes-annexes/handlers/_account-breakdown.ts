/**
 * Helper commun aux notes annexes basées sur une ventilation simple de
 * comptes (préfixes → catégories). Couvre les notes N4, N8..N16, N19..N27,
 * N29, N30 — toutes suivent le pattern « lister par préfixe, sommer débit
 * et crédit, retourner debit/credit/net ».
 *
 * Volontairement aligné sur la forme de sortie historique (handleN7Clients,
 * handleN17Fournisseurs) pour ne pas casser les consommateurs PDF/XLSX.
 */

import type { NoteHandlerDependencies, NoteRow } from '../types';

export interface BreakdownCategory {
  readonly key: string;
  readonly label: string;
  readonly prefixes: ReadonlyArray<string>;
}

export interface BreakdownOptions {
  readonly categories: ReadonlyArray<BreakdownCategory>;
  readonly totalLabel: string;
}

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Calcule la ventilation par préfixe pour une période donnée et retourne
 * la structure normalisée { rows, applicable } attendue par le service.
 *
 * `applicable` est vrai dès qu'au moins une catégorie (hors TOTAL) a un
 * mouvement (débit ou crédit). Sinon la note est marquée N/A.
 */
export async function computeAccountBreakdown(
  organizationId: string,
  periodEnd: string,
  deps: NoteHandlerDependencies,
  options: BreakdownOptions,
): Promise<{ rows: ReadonlyArray<NoteRow>; applicable: boolean }> {
  const balances = await deps.reports.accountBalancesAsAt(organizationId, periodEnd);

  const totals = new Map<string, number>();
  for (const cat of options.categories) totals.set(cat.key, 0);

  for (const b of balances) {
    const net = num(b.totalDebit) - num(b.totalCredit);
    for (const cat of options.categories) {
      if (cat.prefixes.some((p) => b.accountCode.startsWith(p))) {
        totals.set(cat.key, (totals.get(cat.key) ?? 0) + net);
        break;
      }
    }
  }

  let grandDebit = 0;
  let grandCredit = 0;
  const rows: NoteRow[] = options.categories.map((cat) => {
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
    label: options.totalLabel,
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
}
