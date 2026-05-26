/**
 * W3.1 — Payload de modification d'une provision (label seulement).
 *
 * Les montants ne sont JAMAIS modifies via UPDATE : on passe par les
 * methodes dediees `dotation`, `reprise`, `utilization` qui generent
 * un mouvement audite + une eventuelle ecriture comptable.
 *
 * Le status est gere par le service (close manuelle via `cancel`,
 * ou close automatique quand `currentAmount` tombe a 0).
 */
export class UpdateProvisionDto {
  readonly label?: string;
}
