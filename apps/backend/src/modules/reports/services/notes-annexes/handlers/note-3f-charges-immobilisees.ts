/**
 * Note 3F — Tableau d'étalement des charges immobilisées (Tome 3 p. 42).
 *
 * Doctrine SYSCOHADA : les charges immobilisées (compte 20) regroupent
 * les frais d'établissement et les charges à répartir sur plusieurs
 * exercices. La note présente, par sous-compte :
 *   - 201 Frais d'établissement
 *   - 202 Charges à répartir sur plusieurs exercices
 *   - 206 Primes de remboursement des obligations
 *
 * Pour chaque ligne : valeur brute à la clôture, amortissements cumulés
 * (compte 28/20…) et valeur nette comptable. Faute d'amortissements
 * dédiés au compte 20 dans tous les plans, on rend la valeur brute par
 * sous-compte ; l'amortissement est laissé pour le commentaire libre
 * (suivi : extension via `assets` si un schéma d'étalement dédié est
 * livré).
 */
import type { NoteHandler, NoteRow } from '../types';

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

const CATEGORIES: ReadonlyArray<{ readonly prefix: string; readonly label: string }> = [
  { prefix: '201', label: "201 — Frais d'établissement" },
  { prefix: '202', label: '202 — Charges à répartir sur plusieurs exercices' },
  { prefix: '203', label: '203 — Frais de recherche et de développement' },
  { prefix: '206', label: '206 — Primes de remboursement des obligations' },
  { prefix: '208', label: '208 — Autres charges immobilisées' },
];

export const handleN3fChargesImmobilisees: NoteHandler = async (ctx, deps) => {
  const balances = await deps.reports.accountBalancesAsAt(
    ctx.organizationId as string,
    ctx.periodEnd,
  );

  const totals = new Map<string, { brut: number; amort: number }>();
  for (const cat of CATEGORIES) totals.set(cat.prefix, { brut: 0, amort: 0 });

  for (const b of balances) {
    const brutNet = num(b.totalDebit) - num(b.totalCredit);
    if (Math.abs(brutNet) < 0.005) continue;
    for (const cat of CATEGORIES) {
      if (b.accountCode.startsWith(cat.prefix)) {
        const slot = totals.get(cat.prefix)!;
        // 20… brut au débit, amortissements (28xx liés) traités via compte 28
        // ⇒ on agrège ici uniquement le brut. L'amort cumul reste 0 par défaut
        // tant qu'on n'a pas de mapping 28→20 explicite.
        totals.set(cat.prefix, { brut: slot.brut + brutNet, amort: slot.amort });
        break;
      }
    }
  }

  const rows: NoteRow[] = [];
  let grandBrut = 0;
  let grandAmort = 0;
  for (const cat of CATEGORIES) {
    const slot = totals.get(cat.prefix)!;
    if (Math.abs(slot.brut) < 0.005 && Math.abs(slot.amort) < 0.005) continue;
    const vnc = slot.brut - slot.amort;
    grandBrut += slot.brut;
    grandAmort += slot.amort;
    rows.push({
      key: cat.prefix,
      label: cat.label,
      values: {
        brut: fmt(slot.brut),
        amort: fmt(slot.amort),
        vnc: fmt(vnc),
      },
    });
  }

  if (rows.length > 0) {
    rows.push({
      key: 'TOTAL',
      label: 'TOTAL charges immobilisées',
      values: {
        brut: fmt(grandBrut),
        amort: fmt(grandAmort),
        vnc: fmt(grandBrut - grandAmort),
      },
    });
  }

  return { rows, applicable: rows.length > 0 };
};
