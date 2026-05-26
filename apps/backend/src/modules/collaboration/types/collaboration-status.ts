/**
 * `CollaborationStatus` — état du cycle de vie d'une demande de
 * justificatif (Module 21 wave 1).
 *
 * Flow autorisé (`isStatusTransitionAllowed`) :
 *
 *   open          → in_progress   (le client commence à répondre)
 *   open          → cancelled     (le cabinet annule)
 *   in_progress   → completed     (le client a fourni le justificatif)
 *   in_progress   → open          (retour en attente si non concluant)
 *   in_progress   → cancelled     (le cabinet annule)
 *   completed     → in_progress   (réouverture par le cabinet si rejet)
 *   cancelled     → (terminal)
 *
 * Les transitions sont contrôlées par `CollaborationRequestsService.updateStatus`,
 * pas au niveau DB. Une `CHECK` empêche les valeurs hors énumération.
 */
export const COLLABORATION_STATUS_VALUES = [
  'open',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type CollaborationStatus = (typeof COLLABORATION_STATUS_VALUES)[number];

const ALLOWED_TRANSITIONS: Readonly<
  Record<CollaborationStatus, ReadonlyArray<CollaborationStatus>>
> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'open', 'cancelled'],
  completed: ['in_progress'],
  cancelled: [],
};

export function isStatusTransitionAllowed(
  from: CollaborationStatus,
  to: CollaborationStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}
