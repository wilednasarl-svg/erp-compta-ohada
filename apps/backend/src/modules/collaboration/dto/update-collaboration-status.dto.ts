import { IsIn } from 'class-validator';

import {
  COLLABORATION_STATUS_VALUES,
  type CollaborationStatus,
} from '../types/collaboration-status';

/**
 * `PATCH /collaboration/requests/:id/status` body. La validité de la
 * transition (open → in_progress, etc.) est contrôlée par le service
 * via `isStatusTransitionAllowed` — pas par cette validation DTO,
 * qui se borne à vérifier l'appartenance à l'énumération.
 */
export class UpdateCollaborationStatusDto {
  @IsIn(COLLABORATION_STATUS_VALUES as ReadonlyArray<string>)
  status!: CollaborationStatus;
}
