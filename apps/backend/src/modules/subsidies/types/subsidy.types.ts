/**
 * W4.4 — Types et comptes SYSCOHADA pour les subventions d'investissement
 * (Tome 2 chap. 17, App. 66).
 *
 * Comptes utilisés :
 *   - 4494 : subventions d'investissement à recevoir (créance sur le bailleur)
 *   - 521  : banque (si encaissement immédiat)
 *   - 1411 : subventions d'investissement reçues (capitaux propres)
 *   - 799  : reprise au compte de résultat (subvention virée au résultat)
 *
 * Convention wave 1 : l'octroi crédite toujours 1411 ; le débit est
 * porté par `grantDebitAccount` (4494 par défaut, 521 si encaissement
 * immédiat). Cf. `DEFAULT_GRANT_DEBIT_ACCOUNT`.
 */

export type SubsidyReleaseMethod = 'on_depreciation' | 'linear_10y' | 'manual';

export type SubsidyStatus = 'active' | 'fully_released' | 'cancelled';

/** Compte SYSCOHADA crédité à l'octroi (capitaux propres, classe 14). */
export const SUBSIDY_GRANT_LIABILITY_ACCOUNT = '1411';

/**
 * Compte par défaut débité à l'octroi : créance sur le bailleur (4494).
 * Pour un encaissement direct, le caller passe '521' (banque) dans le DTO.
 */
export const DEFAULT_GRANT_DEBIT_ACCOUNT = '4494';

/** Compte de produit crédité à chaque reprise (transfert au résultat). */
export const SUBSIDY_RELEASE_INCOME_ACCOUNT = '799';

/**
 * Durée d'étalement par défaut pour la méthode `linear_10y` (asset non
 * amortissable ou subvention non liée à un asset). 10 ans = 120 mois.
 */
export const LINEAR_RELEASE_MONTHS = 120;
