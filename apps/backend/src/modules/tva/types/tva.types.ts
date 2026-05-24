/**
 * Module 13 — TVA & Déclarations fiscales OHADA Côte d'Ivoire.
 *
 * Périmètre wave 1 : régime du Réel Normal d'Imposition (RNI) avec
 * déclaration mensuelle. Les codes TVA ci-dessous reflètent les taux en
 * vigueur en Côte d'Ivoire (CGI 2024). Les comptes par défaut respectent
 * le plan SYSCOHADA AUDCIF :
 *
 *   - 443x  → TVA collectée (vente)
 *   - 4451  → TVA déductible sur immobilisations
 *   - 4452  → TVA déductible sur biens & services
 *   - 4441  → TVA due (état)
 *   - 4449  → Crédit de TVA à reporter
 */

/** Direction d'application d'un code TVA. */
export type TvaCodeType = 'sales' | 'purchase' | 'both';

/** Nature fiscale d'un code TVA. */
export type TvaCodeKind = 'normal' | 'reduced' | 'exempt' | 'exonerated' | 'export';

/** Statut d'une déclaration TVA. */
export type TvaDeclarationStatus = 'draft' | 'calculated' | 'cancelled';

/** Direction d'agrégation d'une ligne de déclaration. */
export type TvaDeclarationLineDirection = 'collected' | 'deductible_bs' | 'deductible_immo';

/**
 * Préfixes de comptes SYSCOHADA pour l'agrégation TVA (wave 1).
 *
 * On agrège par préfixe parce que les sous-comptes (44311, 44312, ...)
 * peuvent être personnalisés par l'organisation, mais la racine reste
 * fixée par le plan SYSCOHADA. La wave 2 introduira le tagging fin par
 * code TVA sur chaque ligne d'écriture.
 */
export const TVA_ACCOUNT_PREFIXES = {
  /** TVA collectée sur ventes — comptes 443x. Sens crédit. */
  collected: '443',
  /** TVA déductible sur biens & services — comptes 4452, 4453, 4454, 4455. Sens débit. */
  deductibleBs: ['4452', '4453', '4454', '4455'] as const,
  /** TVA déductible sur immobilisations — compte 4451. Sens débit. */
  deductibleImmo: '4451',
  /** Compte de l'écriture de centralisation (état, TVA due). */
  due: '4441',
  /** Compte du crédit reportable. */
  creditReportable: '4449',
} as const;

/**
 * Codes TVA par défaut Côte d'Ivoire — seed à la création d'une org.
 *
 * Source : Code Général des Impôts CI 2024, article 357.
 */
export interface DefaultTvaCodeSeed {
  readonly code: string;
  readonly label: string;
  readonly rate: string;
  readonly type: TvaCodeType;
  readonly kind: TvaCodeKind;
}

export const DEFAULT_TVA_CODES_CI: ReadonlyArray<DefaultTvaCodeSeed> = [
  {
    code: 'TVA-N-18',
    label: 'TVA Normale 18% (taux standard CI)',
    rate: '18.00',
    type: 'both',
    kind: 'normal',
  },
  {
    code: 'TVA-N-09',
    label: 'TVA Réduite 9% (biens spécifiques CI)',
    rate: '9.00',
    type: 'both',
    kind: 'reduced',
  },
  {
    code: 'TVA-EXO',
    label: 'TVA Exonérée (opérations locales)',
    rate: '0.00',
    type: 'both',
    kind: 'exonerated',
  },
  {
    code: 'TVA-EXP',
    label: 'TVA Export 0% (exportations hors UEMOA)',
    rate: '0.00',
    type: 'sales',
    kind: 'export',
  },
];

/** Format validation regex pour les codes TVA (lettres maj, chiffres, tirets). */
export const TVA_CODE_PATTERN = /^[A-Z0-9-]{1,16}$/;
