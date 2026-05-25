import { Injectable, Logger } from '@nestjs/common';

import type { CollaborationCommentEntity } from '../entities/collaboration-comment.entity';
import type { CollaborationRequestEntity } from '../entities/collaboration-request.entity';
import type { CollaborationStatus } from '../types/collaboration-status';

/**
 * `CollaborationNotificationsService` (wave 1 — stub).
 *
 * Surface stable consommée par `CollaborationRequestsService` à chaque
 * événement métier (création, changement de statut, nouveau commentaire).
 * Wave 1 : on log à INFO et on s'arrête là — l'objectif est de figer
 * l'API qu'utilisera la wave 2 (email + notification temps réel via
 * `EmailModule` + un canal websocket à câbler).
 *
 * Toutes les méthodes sont fire-and-forget côté caller (`void` Promise) :
 * la défaillance d'une notification ne doit JAMAIS bricker la demande
 * elle-même. Wave 2 introduira un retry + une dead-letter queue.
 */
@Injectable()
export class CollaborationNotificationsService {
  private readonly logger = new Logger(CollaborationNotificationsService.name);

  async notifyRequestCreated(request: CollaborationRequestEntity): Promise<void> {
    this.logger.log(
      `notifyRequestCreated: org=${request.organizationId} request=${request.id} ` +
        `requester=${request.requesterId} assignee=${request.assigneeId ?? 'none'} ` +
        `title="${request.title}"`,
    );
  }

  async notifyStatusChanged(
    request: CollaborationRequestEntity,
    from: CollaborationStatus,
    to: CollaborationStatus,
    actorUserId: string,
  ): Promise<void> {
    this.logger.log(
      `notifyStatusChanged: org=${request.organizationId} request=${request.id} ` +
        `${from} → ${to} by user=${actorUserId}`,
    );
  }

  async notifyCommentAdded(
    request: CollaborationRequestEntity,
    comment: CollaborationCommentEntity,
  ): Promise<void> {
    this.logger.log(
      `notifyCommentAdded: org=${request.organizationId} request=${request.id} ` +
        `comment=${comment.id} author=${comment.authorId}`,
    );
  }
}
