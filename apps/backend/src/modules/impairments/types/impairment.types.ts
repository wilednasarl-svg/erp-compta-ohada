/**
 * W3.2 — Types et mapping des comptes SYSCOHADA pour les dépréciations.
 *
 * Sources :
 *   - Tome 2 chap. 12 (immobilisations) : compte 29x en dépréciation,
 *     6917 dotation / 7917 reprise (immo amortissable). Pour immo non
 *     amortissable (terrains, fonds), 6914 / 7914 — non géré en wave 1.
 *   - Tome 2 chap. 14 (stocks) : compte 39x en dépréciation, 6593
 *     dotation / 7593 reprise.
 *   - App. 44 : reprise plafonnée au cumul des dépréciations antérieures
 *     (on ne peut pas "gonfler" la valeur au-delà de l'historique).
 */

export type ImpairmentType = 'depreciation' | 'reprise';

/**
 * Mapping classe immo (premier digit du compte de stock 21x..24x) →
 * compte 29x de dépréciation. Tableau extrait du PCG SYSCOHADA.
 *
 * 21x (terrains)    → 291
 * 22x (constructions, fonds commercial) → 292
 * 23x (installations techniques, ITMOI) → 293
 * 24x (matériel et mobilier)            → 294
 *
 * Fallback : 29 (compte racine) si la classe ne matche pas.
 */
export function depreciationContraAccountFor(assetAccountCode: string): string {
  const head = assetAccountCode.charAt(0);
  if (head !== '2') return '29';
  const second = assetAccountCode.charAt(1);
  switch (second) {
    case '1':
      return '291';
    case '2':
      return '292';
    case '3':
      return '293';
    case '4':
      return '294';
    case '5':
      return '295';
    case '6':
      return '296';
    default:
      return '29';
  }
}

/**
 * Mapping classe stock (premier digit 31..37) → compte 39x.
 *
 * 31 marchandises  → 391
 * 32 matières      → 392
 * 33 autres appro  → 393
 * 34 prod. en cours → 394
 * 35 prod. finis   → 395
 * 36 prod. résiduels → 396
 * 37 stocks externes → 397
 */
export function inventoryContraAccountFor(stockAccountCode: string): string {
  const head = stockAccountCode.substring(0, 2);
  if (head.charAt(0) !== '3') return '39';
  const second = head.charAt(1);
  switch (second) {
    case '1':
      return '391';
    case '2':
      return '392';
    case '3':
      return '393';
    case '4':
      return '394';
    case '5':
      return '395';
    case '6':
      return '396';
    case '7':
      return '397';
    default:
      return '39';
  }
}

/**
 * Comptes SYSCOHADA des dotations / reprises (Tome 2).
 * Wave 1 : on utilise 6917 / 7917 pour immo amortissable (cas le plus
 * fréquent ; gérer 6914 / 7914 pour terrains et fonds dans une wave
 * ultérieure si nécessaire). Pour stocks : 6593 / 7593.
 */
export const ASSET_IMPAIRMENT_EXPENSE_ACCOUNT = '6917';
export const ASSET_IMPAIRMENT_REVERSAL_ACCOUNT = '7917';
export const INVENTORY_IMPAIRMENT_EXPENSE_ACCOUNT = '6593';
export const INVENTORY_IMPAIRMENT_REVERSAL_ACCOUNT = '7593';
