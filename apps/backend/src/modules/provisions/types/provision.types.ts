/**
 * W3.1 — Provisions pour risques et charges SYSCOHADA.
 *
 * Vocabulaire metier (chap. 18 + 21 du tome "operations specifiques") :
 *   - `litige`          : provision pour litige avec un tiers
 *   - `garantie`        : provision pour garanties donnees aux clients
 *   - `restructuration` : provision pour restructuration / plan social
 *   - `perte_change`    : provision pour perte latente de change (financier)
 *   - `retraite`        : provision pour engagements de retraite
 *   - `demantelement`   : provision pour cout de demantelement /
 *                         remise en etat d'un site
 *
 * Cycle de vie d'une provision :
 *   active   → en cours, current_amount > 0
 *   closed   → soldee par reprises successives (current_amount = 0)
 *   cancelled → annulee manuellement (provision sans objet)
 *
 * Mouvements (`ProvisionMovementKind`) :
 *   dotation     : augmente current_amount, ecriture D 691x / C 19x
 *   reprise      : diminue current_amount, ecriture D 19x / C 791x
 *   utilization  : diminue current_amount, sans ecriture comptable
 *                  (le paiement est pose par un autre module)
 */

export type ProvisionType =
  | 'litige'
  | 'garantie'
  | 'restructuration'
  | 'demantelement'
  | 'retraite'
  | 'perte_change';

export type ProvisionStatus = 'active' | 'cancelled' | 'closed';

export type ProvisionMovementKind = 'dotation' | 'reprise' | 'utilization';

export const PROVISION_TYPES: ReadonlyArray<ProvisionType> = [
  'litige',
  'garantie',
  'restructuration',
  'demantelement',
  'retraite',
  'perte_change',
];

export const PROVISION_STATUSES: ReadonlyArray<ProvisionStatus> = ['active', 'cancelled', 'closed'];

export const PROVISION_MOVEMENT_KINDS: ReadonlyArray<ProvisionMovementKind> = [
  'dotation',
  'reprise',
  'utilization',
];

/**
 * Compte 19x cible pour la provision elle-meme (passif).
 * Source : SYSCOHADA AUDCIF — classe 19 "Provisions pour risques et charges".
 */
export const PROVISION_TYPE_ACCOUNT_MAP: Readonly<Record<ProvisionType, string>> = {
  litige: '191',
  garantie: '192',
  restructuration: '193',
  perte_change: '194',
  retraite: '196',
  demantelement: '1984',
} as const;

/**
 * Compte de dotation utilise lors de la creation/augmentation
 * d'une provision (debit). Les comptes 691x sont des charges
 * d'exploitation, sauf `perte_change` qui touche le 697x (financier).
 */
export const PROVISION_DOTATION_ACCOUNT_MAP: Readonly<Record<ProvisionType, string>> = {
  litige: '6911',
  garantie: '6911',
  restructuration: '6912',
  perte_change: '6971',
  retraite: '6913',
  demantelement: '6915',
} as const;

/**
 * Compte de reprise utilise lorsque la provision est diminuee
 * (provision sans objet ou partiellement utilisee). Symetrique au
 * compte de dotation (791x produits d'exploitation, 797x produits
 * financiers pour la perte de change).
 */
export const PROVISION_REPRISE_ACCOUNT_MAP: Readonly<Record<ProvisionType, string>> = {
  litige: '7911',
  garantie: '7911',
  restructuration: '7912',
  perte_change: '7971',
  retraite: '7913',
  demantelement: '7915',
} as const;

/**
 * Resout le compte 19x cible pour un type de provision donne.
 * Fonction pure — pas d'I/O, pas d'effet de bord.
 */
export function resolveProvisionAccount(type: ProvisionType): string {
  return PROVISION_TYPE_ACCOUNT_MAP[type];
}

/**
 * Resout le compte de dotation (691x ou 697x) pour un type donne.
 */
export function resolveDotationAccount(type: ProvisionType): string {
  return PROVISION_DOTATION_ACCOUNT_MAP[type];
}

/**
 * Resout le compte de reprise (791x ou 797x) pour un type donne.
 */
export function resolveRepriseAccount(type: ProvisionType): string {
  return PROVISION_REPRISE_ACCOUNT_MAP[type];
}
