/**
 * Contrôle de cohérence registre d'immobilisations ↔ comptabilité
 * (issue 8vny), partagé par les Notes 3A (corporelles) et 3B
 * (incorporelles).
 *
 * Les tableaux de variation 3A/3B sont alimentés par le sous-module
 * `assets` + `depreciation_schedules`. Si ce registre se désynchronise
 * des comptes de classe 2 (saisie manuelle d'écriture sans pendant dans
 * le registre, ou inversement), la VNC de la note diverge du net
 * comptable du bilan. On rapproche les deux et on signale tout écart.
 *
 * Net comptable = Σ (débit − crédit) sur les comptes concernés :
 *   - brut          (ex. 22/23/24 corporels, 21x incorporels) : débiteurs
 *   - amortissements (28x)                                     : créditeurs
 *   - dépréciations  (29x)                                     : créditeurs
 * La somme (débit − crédit) donne donc directement brut − amort − dépréc,
 * c.-à-d. la Valeur Nette Comptable au bilan.
 */

import type { NoteRow } from '../types';

interface BalanceRow {
  readonly accountCode: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

/** Tolérance d'arrondi (1 unité monétaire, XOF) sous laquelle on
 *  considère registre et comptabilité concordants. */
const ECART_TOLERANCE = 1;

function toNum(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Construit la ligne de contrôle de cohérence à ajouter en bas du
 * tableau. Retourne `null` quand registre et comptabilité concordent
 * (écart ≤ tolérance) — aucun bruit n'est ajouté dans ce cas.
 *
 * @param balances        soldes `accountBalancesAsAt` à la clôture
 * @param netPrefixes     préfixes des comptes brut + amort + dépréc
 * @param vncRegistre     VNC clôture issue du registre (ligne TOTAL)
 * @param columnKeys      clés de colonnes de la note (pour remplir à vide)
 */
export function buildReconciliationRow(
  balances: ReadonlyArray<BalanceRow>,
  netPrefixes: readonly string[],
  vncRegistre: number,
  columnKeys: readonly string[],
): NoteRow | null {
  let netComptable = 0;
  for (const b of balances) {
    if (netPrefixes.some((p) => b.accountCode.startsWith(p))) {
      netComptable += toNum(b.totalDebit) - toNum(b.totalCredit);
    }
  }

  const ecart = vncRegistre - netComptable;
  if (Math.abs(ecart) <= ECART_TOLERANCE) return null;

  const values: Record<string, string> = {};
  for (const k of columnKeys) values[k] = '';
  // La colonne VNC porte le net comptable, à comparer visuellement avec
  // la VNC du registre de la ligne TOTAL juste au-dessus.
  values.vnc = netComptable.toFixed(2);

  return {
    key: 'CONTROLE_COHERENCE',
    label:
      `⚠ Net comptable bilan (classe 2) — écart registre/comptabilité ` +
      `de ${ecart.toFixed(2)} à régulariser`,
    values,
  };
}

/** Préfixes de comptes pour le rapprochement (Note 3A — corporelles). */
export const RECON_PREFIXES_CORP: readonly string[] = [
  '22',
  '23',
  '24',
  '282',
  '283',
  '284',
  '292',
  '293',
  '294',
];

/** Préfixes de comptes pour le rapprochement (Note 3B — incorporelles). */
export const RECON_PREFIXES_INCORP: readonly string[] = ['21', '281', '291'];

/** Helpers exportés pour les tests. */
export const __testing = { toNum, ECART_TOLERANCE };
