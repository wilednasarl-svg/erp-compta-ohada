/**
 * W4.5 — Crédit-bail / location-acquisition SYSCOHADA.
 *
 * Vocabulaire (Tome 2 chap. 8, App. 37-38) :
 *   - `monthly`    : 12 échéances par an (loyers mensuels)
 *   - `quarterly`  : 4  échéances par an
 *   - `annual`     : 1  échéance par an
 *
 * Cycle de vie d'un contrat :
 *   active     → loyers en cours, dette > 0
 *   closed     → dette intégralement remboursée
 *   cancelled  → contrat résilié avant terme (pas d'écriture pour
 *                la résiliation côté module — à la charge de l'utilisateur)
 *
 * Comptes SYSCOHADA agités (mapping figé ici, pas en DB) :
 *
 *   Prise du contrat    | D 2411 (matériel) / C 173 (dette)
 *   Échéance loyer      | D 6724 (intérêts) + D 173 (capital) / C 521
 *
 * Tous les montants sont en NUMERIC(15,2) côté DB et `string` côté
 * TypeORM (cf. pattern AssetEntity / ProvisionEntity).
 */

export type LeaseFrequency = 'monthly' | 'quarterly' | 'annual';

export type LeaseStatus = 'active' | 'closed' | 'cancelled';

export const LEASE_FREQUENCIES: ReadonlyArray<LeaseFrequency> = [
  'monthly',
  'quarterly',
  'annual',
];

export const LEASE_STATUSES: ReadonlyArray<LeaseStatus> = [
  'active',
  'closed',
  'cancelled',
];

/**
 * Comptes SYSCOHADA agités par les écritures du module.
 * Centralisés ici pour qu'un changement de plan comptable ne
 * dissémine pas de chaînes magiques à travers le service.
 */
export const LEASE_ACCOUNTS = {
  /** 2411 — Matériel et outillage financé par crédit-bail. */
  ASSET: '2411',
  /** 173 — Dettes de location-acquisition. */
  DEBT: '173',
  /** 6724 — Intérêts sur dettes de location-acquisition. */
  INTEREST_EXPENSE: '6724',
  /** 521 — Banque (décaissement du loyer). */
  BANK: '521',
} as const;

/**
 * Code journal par défaut pour les écritures de crédit-bail.
 * `OD` (opérations diverses) est seedé par OrganizationsService pour
 * toute organisation SYSCOHADA.
 */
export const LEASE_DEFAULT_JOURNAL_CODE = 'OD' as const;

/**
 * Nombre de périodes par an selon la fréquence du contrat.
 * Sert au calcul du taux périodique à partir du taux annuel
 * (et inversement).
 */
export function periodsPerYear(frequency: LeaseFrequency): number {
  switch (frequency) {
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'annual':
      return 1;
  }
}
