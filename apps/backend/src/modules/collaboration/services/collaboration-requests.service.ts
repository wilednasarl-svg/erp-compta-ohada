import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import type { CollaborationCommentEntity } from '../entities/collaboration-comment.entity';
import type { CollaborationRequestEntity } from '../entities/collaboration-request.entity';
import {
  CollaborationCommentRepository,
} from '../repositories/collaboration-comment.repository';
import {
  CollaborationRequestRepository,
  type CollaborationRequestListFilters,
  type PaginationOptions,
} from '../repositories/collaboration-request.repository';
import {
  isStatusTransitionAllowed,
  type CollaborationStatus,
} from '../types/collaboration-status';
import { CollaborationNotificationsService } from './collaboration-notifications.service';

/**
 * Scope demandé par le caller. Le controller le dérive du rôle JWT :
 *   - `cabinet` : voit toutes les demandes de l'org.
 *   - `client`  : voit uniquement les demandes où il est assignee.
 */
export type CollaborationViewScope = 'cabinet' | 'client';

export interface CreateRequestInputs {
  readonly title: string;
  readonly description: string | null;
  readonly assigneeId: string | null;
  readonly linkedEntryId: string | null;
  readonly linkedDocumentId: string | null;
  readonly dueDate: string | null;
}

export interface RequestView {
  readonly id: string;
  readonly organizationId: string;
  readonly requesterId: string;
  readonly assigneeId: string | null;
  readonly status: CollaborationStatus;
  readonly title: string;
  readonly description: string | null;
  readonly linkedEntryId: string | null;
  readonly linkedDocumentId: string | null;
  readonly dueDate: string | null;
  readonly completedAt: string | null;
  readonly completedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CommentView {
  readonly id: string;
  readonly requestId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface ListRequestsResult {
  readonly rows: ReadonlyArray<RequestView>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * `CollaborationRequestsService` (BE-COLLAB-04) — orchestre les
 * demandes de justificatifs cabinet ↔ client.
 *
 * Multi-tenant
 * ------------
 * Toutes les méthodes publiques prennent `organizationId` et délèguent
 * aux repos qui passent par `assertTenantId`. Une demande cross-tenant
 * résout en `COLLAB_REQUEST_NOT_FOUND` (404) — jamais 403 — pour ne pas
 * révéler son existence.
 *
 * Scope visuel (cabinet vs client)
 * --------------------------------
 * `listForActor` accepte un `viewScope` issu du rôle JWT. En mode
 * `client`, on force le filtre `assigneeId = actorUserId` pour qu'un
 * compte client ne voie jamais les demandes adressées à un autre
 * client de la même org. Le permission-guard accorde déjà
 * `collaboration.read` au rôle `client_readonly` — c'est ici qu'on
 * tightening la portée des données qu'il peut consulter.
 *
 * State machine status
 * --------------------
 * Toute transition passe par `isStatusTransitionAllowed` (cf.
 * `types/collaboration-status.ts`). Les transitions interdites
 * remontent `COLLAB_INVALID_TRANSITION` (422) avec from/to dans
 * `details`. Une transition vers `completed` stamp `completed_at` +
 * `completed_by` ; toute autre transition les remet à NULL pour rester
 * cohérent (un re-open efface l'horodatage de complétion).
 *
 * Audit (Module 7)
 * ----------------
 * Trois actions :
 *   - `request_created`       — émise après l'INSERT, `after` = facts.
 *   - `request_status_changed` — `before`/`after` = `{ status }`.
 *   - `comment_added`         — `after` = `{ commentId, length }`,
 *                                 le corps n'est PAS journalisé (PII).
 *
 * Les échecs d'audit sont swallow-and-warn (cf. `AuditTrailService`),
 * donc une demande ne peut jamais être bloquée par un journal flaky.
 */
@Injectable()
export class CollaborationRequestsService {
  private static readonly MODULE = 'collaboration' as const;
  private static readonly REQUEST_ENTITY = 'collaboration_request' as const;
  private static readonly COMMENT_ENTITY = 'collaboration_comment' as const;

  private readonly logger = new Logger(CollaborationRequestsService.name);

  constructor(
    private readonly requests: CollaborationRequestRepository,
    private readonly comments: CollaborationCommentRepository,
    private readonly notifications: CollaborationNotificationsService,
    private readonly audit: AuditTrailService,
  ) {}

  async createRequest(
    organizationId: TenantId,
    requesterUserId: string,
    inputs: CreateRequestInputs,
    ctx: AuditContext = { ipAddress: null, userAgent: null },
  ): Promise<RequestView> {
    const title = inputs.title.trim();
    if (title.length === 0) {
      throw new AppException(ERROR_CODES.COLLAB_TITLE_REQUIRED, {
        message: 'Request title is required',
      });
    }

    let row: CollaborationRequestEntity;
    try {
      row = await this.requests.createOne({
        organizationId,
        requesterId: requesterUserId,
        assigneeId: inputs.assigneeId,
        title,
        description: this.normalizeDescription(inputs.description, 5000),
        linkedEntryId: inputs.linkedEntryId,
        linkedDocumentId: inputs.linkedDocumentId,
        dueDate: inputs.dueDate,
      });
    } catch (error: unknown) {
      // Une FK invalide (assignee_id inconnu, linked_entry_id supprimé
      // entre-temps, linked_document_id cross-tenant) remonte ici comme
      // une `QueryFailedError` PG. On la mappe en 422 plutôt qu'en 500
      // pour que le client comprenne que c'est une donnée invalide, pas
      // une panne serveur. Le sha de l'erreur PG (`23503`) suffit à
      // discriminer ; on garde la sécurité de ne pas leak le détail SQL.
      if (this.isForeignKeyViolation(error)) {
        throw new AppException(ERROR_CODES.COLLAB_LINKED_NOT_FOUND, {
          message: 'One of the referenced entities (assignee, entry or document) does not exist',
        });
      }
      throw error;
    }

    await this.audit.record({
      module: CollaborationRequestsService.MODULE,
      action: 'request_created',
      entityType: CollaborationRequestsService.REQUEST_ENTITY,
      entityId: row.id,
      after: {
        title: row.title,
        assigneeId: row.assigneeId,
        linkedEntryId: row.linkedEntryId,
        linkedDocumentId: row.linkedDocumentId,
        dueDate: row.dueDate,
      },
      metadata: { requesterId: row.requesterId },
      ctx: { ...ctx, userId: requesterUserId, organizationId },
    });

    this.notifications.notifyRequestCreated(row).catch((error: unknown) => {
      this.logger.warn(
        `createRequest: notification failed for request ${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return this.toRequestView(row);
  }

  async getForActor(
    organizationId: TenantId,
    id: string,
    actorUserId: string,
    viewScope: CollaborationViewScope,
  ): Promise<RequestView> {
    const row = await this.fetchVisibleRequest(organizationId, id, actorUserId, viewScope);
    return this.toRequestView(row);
  }

  async listForActor(
    organizationId: TenantId,
    actorUserId: string,
    viewScope: CollaborationViewScope,
    filters: CollaborationRequestListFilters,
    pagination: PaginationOptions,
  ): Promise<ListRequestsResult> {
    // Scope client : on impose le filtre assignee_id = actorUserId,
    // y compris si le client tente de passer `assigneeId=<autre>` en
    // query string (on écrase). C'est la garde anti-énumération côté
    // service — défense en profondeur du permission-guard.
    const effectiveFilters: CollaborationRequestListFilters =
      viewScope === 'client' ? { ...filters, assigneeId: actorUserId } : filters;

    const { rows, total } = await this.requests.listForOrg(
      organizationId,
      effectiveFilters,
      pagination,
    );

    return {
      rows: rows.map((row) => this.toRequestView(row)),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  async updateStatus(
    organizationId: TenantId,
    id: string,
    actorUserId: string,
    viewScope: CollaborationViewScope,
    nextStatus: CollaborationStatus,
    ctx: AuditContext = { ipAddress: null, userAgent: null },
  ): Promise<RequestView> {
    const row = await this.fetchVisibleRequest(organizationId, id, actorUserId, viewScope);

    if (!isStatusTransitionAllowed(row.status, nextStatus)) {
      throw new AppException(ERROR_CODES.COLLAB_INVALID_TRANSITION, {
        message: `Transition ${row.status} → ${nextStatus} is not allowed`,
        details: { from: row.status, to: nextStatus },
      });
    }

    const completedAt = nextStatus === 'completed' ? new Date() : null;
    const completedBy = nextStatus === 'completed' ? actorUserId : null;

    const updated = await this.requests.updateStatus(organizationId, id, {
      status: nextStatus,
      completedAt,
      completedBy,
    });
    if (!updated) {
      // Course concurrente : la demande a disparu entre le SELECT et
      // l'UPDATE. Surface en 404 — c'est l'état observable par le caller.
      throw new AppException(ERROR_CODES.COLLAB_REQUEST_NOT_FOUND, {
        message: 'Collaboration request not found',
      });
    }

    await this.audit.record({
      module: CollaborationRequestsService.MODULE,
      action: 'request_status_changed',
      entityType: CollaborationRequestsService.REQUEST_ENTITY,
      entityId: id,
      before: { status: row.status },
      after: { status: nextStatus },
      metadata: { completedAt: completedAt?.toISOString() ?? null },
      ctx: { ...ctx, userId: actorUserId, organizationId },
    });

    this.notifications
      .notifyStatusChanged(row, row.status, nextStatus, actorUserId)
      .catch((error: unknown) => {
        this.logger.warn(
          `updateStatus: notification failed for request ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    // On relit pour renvoyer la vue à jour (les timestamps `completed_*`
    // et `updated_at` viennent du DB).
    const refreshed = await this.requests.findById(organizationId, id);
    if (refreshed === null) {
      throw new AppException(ERROR_CODES.COLLAB_REQUEST_NOT_FOUND, {
        message: 'Collaboration request not found',
      });
    }
    return this.toRequestView(refreshed);
  }

  async addComment(
    organizationId: TenantId,
    requestId: string,
    actorUserId: string,
    viewScope: CollaborationViewScope,
    body: string,
    ctx: AuditContext = { ipAddress: null, userAgent: null },
  ): Promise<CommentView> {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      throw new AppException(ERROR_CODES.COLLAB_COMMENT_EMPTY, {
        message: 'Comment body cannot be empty',
      });
    }

    const request = await this.fetchVisibleRequest(
      organizationId,
      requestId,
      actorUserId,
      viewScope,
    );

    // Un commentaire sur une demande annulée reste possible mais on
    // bloque sur `completed` pour éviter le bruit après clôture. La
    // réouverture (completed → in_progress) reste accessible côté
    // cabinet via PATCH /status, ce qui ré-ouvre la conversation.
    if (request.status === 'completed') {
      throw new AppException(ERROR_CODES.COLLAB_REQUEST_CLOSED, {
        message: 'Cannot comment on a completed request — reopen it first',
        details: { status: request.status },
      });
    }

    const comment = await this.comments.createOne({
      organizationId,
      requestId,
      authorId: actorUserId,
      body: trimmed,
    });

    await this.audit.record({
      module: CollaborationRequestsService.MODULE,
      action: 'comment_added',
      entityType: CollaborationRequestsService.COMMENT_ENTITY,
      entityId: comment.id,
      // Volontairement, on ne journalise PAS le corps : risque de fuite
      // PII / données financières dans un audit log lu par d'autres
      // rôles. On garde la taille pour les métriques.
      after: { requestId: comment.requestId, bodyLength: comment.body.length },
      metadata: { authorId: actorUserId },
      ctx: { ...ctx, userId: actorUserId, organizationId },
    });

    this.notifications.notifyCommentAdded(request, comment).catch((error: unknown) => {
      this.logger.warn(
        `addComment: notification failed for comment ${comment.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return this.toCommentView(comment);
  }

  async listComments(
    organizationId: TenantId,
    requestId: string,
    actorUserId: string,
    viewScope: CollaborationViewScope,
  ): Promise<ReadonlyArray<CommentView>> {
    // On revérifie la visibilité de la demande avant de remonter les
    // commentaires : empêche un client d'énumérer les commentaires
    // d'une demande dont il connaîtrait l'ID mais qui ne lui est pas
    // assignée.
    await this.fetchVisibleRequest(organizationId, requestId, actorUserId, viewScope);
    const rows = await this.comments.listByRequest(organizationId, requestId);
    return rows.map((row) => this.toCommentView(row));
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async fetchVisibleRequest(
    organizationId: TenantId,
    id: string,
    actorUserId: string,
    viewScope: CollaborationViewScope,
  ): Promise<CollaborationRequestEntity> {
    const row = await this.requests.findById(organizationId, id);
    if (row === null) {
      throw new AppException(ERROR_CODES.COLLAB_REQUEST_NOT_FOUND, {
        message: 'Collaboration request not found',
      });
    }
    if (viewScope === 'client' && row.assigneeId !== actorUserId) {
      // Non-disclosure : même code que si la ligne n'existait pas.
      throw new AppException(ERROR_CODES.COLLAB_REQUEST_NOT_FOUND, {
        message: 'Collaboration request not found',
      });
    }
    return row;
  }

  private toRequestView(row: CollaborationRequestEntity): RequestView {
    return {
      id: row.id,
      organizationId: row.organizationId,
      requesterId: row.requesterId,
      assigneeId: row.assigneeId,
      status: row.status,
      title: row.title,
      description: row.description,
      linkedEntryId: row.linkedEntryId,
      linkedDocumentId: row.linkedDocumentId,
      dueDate: row.dueDate,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedBy: row.completedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCommentView(row: CollaborationCommentEntity): CommentView {
    return {
      id: row.id,
      requestId: row.requestId,
      authorId: row.authorId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private normalizeDescription(value: string | null | undefined, maxLength: number): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, maxLength);
  }

  private isForeignKeyViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const code = (error as { code?: unknown; driverError?: { code?: unknown } }).code;
    if (code === '23503') return true;
    const driverCode = (error as { driverError?: { code?: unknown } }).driverError?.code;
    return driverCode === '23503';
  }
}
