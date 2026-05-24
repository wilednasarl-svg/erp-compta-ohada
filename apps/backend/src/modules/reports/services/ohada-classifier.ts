/**
 * OHADA SYSCOHADA AUDCIF chart-of-accounts classifier — Module 9 wave 2.
 *
 * The OHADA chart organises accounts into 9 top-level classes:
 *
 *   1 — Comptes de ressources durables (capital, réserves, emprunts)
 *   2 — Comptes d'actif immobilisé (incorporel, corporel, financier)
 *   3 — Comptes de stocks
 *   4 — Comptes de tiers (clients, fournisseurs, État, personnel)
 *   5 — Comptes de trésorerie (banques, caisse, instruments)
 *   6 — Comptes de charges
 *   7 — Comptes de produits
 *   8 — Comptes des autres charges et produits (HAO)
 *   9 — Comptes analytiques
 *
 * For wave 2 reports we only need 1-7. Classes 6 & 7 feed the Compte de
 * Résultat (P&L); classes 1-5 feed the Bilan (balance sheet).
 *
 * The mapping below uses the 2-digit `code` prefix (e.g. '60', '70') as
 * the section key. This is the canonical SYSCOHADA AUDCIF grouping
 * granularity used in regulatory templates published by OHADA.
 */

export interface OhadaSectionLabel {
  readonly code: string;
  readonly label: string;
}

/** P&L expense sections (classe 6). */
export const PL_CHARGE_SECTIONS: ReadonlyArray<OhadaSectionLabel> = [
  { code: '60', label: 'Achats et variations de stocks' },
  { code: '61', label: 'Transports' },
  { code: '62', label: 'Services extérieurs A' },
  { code: '63', label: 'Services extérieurs B' },
  { code: '64', label: 'Impôts et taxes' },
  { code: '65', label: 'Autres charges' },
  { code: '66', label: 'Charges de personnel' },
  { code: '67', label: 'Frais financiers et charges assimilées' },
  { code: '68', label: 'Dotations aux amortissements et provisions' },
  { code: '69', label: 'Impôts sur le résultat' },
] as const;

/** P&L revenue sections (classe 7). */
export const PL_PRODUIT_SECTIONS: ReadonlyArray<OhadaSectionLabel> = [
  { code: '70', label: 'Ventes' },
  { code: '71', label: "Subventions d'exploitation" },
  { code: '72', label: 'Production immobilisée' },
  { code: '73', label: 'Variations des stocks de biens et services produits' },
  { code: '75', label: 'Autres produits' },
  { code: '77', label: 'Revenus financiers et assimilés' },
  { code: '78', label: 'Transferts de charges' },
  { code: '79', label: 'Reprises de provisions' },
] as const;

/** Balance-sheet asset sections. */
export type BalanceSheetActifKey = 'IMMOBILISE' | 'CIRCULANT' | 'TRESORERIE_ACTIF';

/** Balance-sheet liability + equity sections. */
export type BalanceSheetPassifKey =
  | 'CAPITAUX_PROPRES'
  | 'DETTES_FINANCIERES'
  | 'PASSIF_CIRCULANT'
  | 'TRESORERIE_PASSIF';

/**
 * Classify an account into a balance-sheet section based on its
 * 2-digit code prefix and the natural side of its ending balance.
 *
 * Convention:
 *   - Classes 2 → Actif immobilisé.
 *   - Classes 3, 4, 5 are dual-sided: a debit balance on a 4xx is a
 *     receivable (Actif circulant); a credit balance on the same 4xx
 *     is a payable (Passif circulant). The classifier uses `netSign`
 *     ('D' or 'C') to pick the right column.
 *   - Class 1 → Passif (capitaux propres / dettes financières).
 *
 * Returns `null` for accounts that don't belong to a balance-sheet
 * line (typically classes 6, 7, 8, 9 — those go to the P&L).
 */
export function classifyForBilan(
  accountCode: string,
  accountClass: number,
  netSign: 'D' | 'C' | 'Z',
):
  | { side: 'ACTIF'; key: BalanceSheetActifKey }
  | { side: 'PASSIF'; key: BalanceSheetPassifKey }
  | null {
  if (accountClass < 1 || accountClass > 5) {
    return null;
  }
  const prefix2 = accountCode.slice(0, 2);

  if (accountClass === 2) {
    return { side: 'ACTIF', key: 'IMMOBILISE' };
  }

  if (accountClass === 1) {
    // 10-15: capitaux propres ; 16-19: dettes financières.
    const n = Number.parseInt(prefix2, 10);
    if (Number.isFinite(n) && n >= 16) {
      return { side: 'PASSIF', key: 'DETTES_FINANCIERES' };
    }
    return { side: 'PASSIF', key: 'CAPITAUX_PROPRES' };
  }

  if (accountClass === 3) {
    // Stocks → Actif circulant.
    return { side: 'ACTIF', key: 'CIRCULANT' };
  }

  if (accountClass === 4) {
    // Tiers : la position dépend du signe.
    if (netSign === 'D') {
      return { side: 'ACTIF', key: 'CIRCULANT' };
    }
    return { side: 'PASSIF', key: 'PASSIF_CIRCULANT' };
  }

  // Class 5 — trésorerie.
  if (netSign === 'D') {
    return { side: 'ACTIF', key: 'TRESORERIE_ACTIF' };
  }
  return { side: 'PASSIF', key: 'TRESORERIE_PASSIF' };
}

export const ACTIF_SECTION_LABELS: Record<BalanceSheetActifKey, string> = {
  IMMOBILISE: 'Actif immobilisé',
  CIRCULANT: 'Actif circulant',
  TRESORERIE_ACTIF: 'Trésorerie — Actif',
};

export const PASSIF_SECTION_LABELS: Record<BalanceSheetPassifKey, string> = {
  CAPITAUX_PROPRES: 'Capitaux propres',
  DETTES_FINANCIERES: 'Dettes financières',
  PASSIF_CIRCULANT: 'Passif circulant',
  TRESORERIE_PASSIF: 'Trésorerie — Passif',
};
