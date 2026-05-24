import { Injectable } from '@nestjs/common';

import type { AuditContext } from '../../audit/services/audit-trail.service';
import { AuditTrailService } from '../../audit/services/audit-trail.service';
import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { WorkflowEventEntity } from '../entities/workflow-event.entity';
import type { WorkflowInstanceEntity } from '../entities/workflow-instance.entity';
import { WorkflowDefinitionRepository } from '../repositories/workflow-definition.repository';
import { WorkflowEventRepository } from '../repositories/workflow-event.repository';
import { WorkflowInstanceRepository } from '../repositories/workflow-instance.repository';
import {
  ALLOWED_TRANSITIONS,
  type WorkflowStatus,
  type WorkflowTargetType,
} from '../types/workflow.types';

export interface StartWorkflowOptions {
  readonly organizationId: string;
  readonly targetType: WorkflowTargetType;
  readonly targetId: string;
  readonly ctx: AuditContext;
}

export interface TransitionOptions {
  readonly instanceId: string;
  readonly organizationId: string;
  readonly toStatus: WorkflowStatus;
  readonly comment?: string | null;
  readonly ctx: AuditContext;
}

export interface WorkflowInstanceView {
  readonly id: string;
  readonly organizationId: string;
  readonly targetType: WorkflowTargetType;
  readonly targetId: string;
  readonly currentStatus: WorkflowStatus;
  readonly startedBy: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

export interface WorkflowEventView {
  readonly id: string;
  readonly fromStatus: WorkflowStatus | null;
  readonly toStatus: WorkflowStatus;
  readonly actorId: string | null;
  readonly comment: string | null;
  readonly occurredAt: Date;
}

/**
 * `WorkflowService` (BE-WF-10) — moteur de workflow générique.
 *
 * Wave 1 : cible `import_session`. Le service gère :
 *   - `startWorkflow`    : crée une instance + event de démarrage.
 *   - `transition`       : change l'état courant après validation du graphe.
 *   - `getHistory`       : retourne la liste ordonnée des events.
 *   - `assertNotLocked`  : guard consommé par les modules métier (ex:
 *     ImportsModule) pour bloquer les opérations sur un objet verrouillé.
 *
 * Toutes les transitions sont journalisées via `AuditTrailService`
 * (module: 'workflows').
 *
 * Graphe d'états :
 *   draft → in_review → approved → locked
 *   in_review → draft  (retour possible)
 *   approved  → in_review (retour possible)
 *   locked    → (aucune transition possible)
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly definitions: WorkflowDefinitionRepository,
    private readonly instances: WorkflowInstanceRepository,
    private readonly events: WorkflowEventRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async startWorkflow(options: StartWorkflowOptions): Promise<WorkflowInstanceView> {
    const { organizationId, targetType, targetId, ctx } = options;

    const definition = await this.definitions.findActiveByTargetType(targetType);
    if (!definition) {
      throw new AppException(ERROR_CODES.WORKFLOW_TRANSITION_INVALID, {
        message: `No active workflow definition found for target type '${targetType}'`,
      });
    }

    const existing = await this.instances.findByTarget(organizationId, targetType, targetId);
    if (existing) {
      return this.toView(existing);
    }

    const instance = await this.instances.create({
      workflowDefinitionId: definition.id,
      organizationId,
      targetType,
      targetId,
      startedBy: ctx.userId ?? null,
    });

    await this.events.record({
      workflowInstanceId: instance.id,
      fromStatus: null,
      toStatus: 'draft',
      actorId: ctx.userId ?? null,
      comment: null,
    });

    await this.audit.record({
      module: 'workflows',
      action: 'started',
      entityType: targetType,
      entityId: targetId,
      after: { instanceId: instance.id, status: 'draft' },
      ctx,
    });

    return this.toView(instance);
  }

  async transition(options: TransitionOptions): Promise<WorkflowInstanceView> {
    const { instanceId, organizationId, toStatus, comment, ctx } = options;

    const instance = await this.instances.findById(instanceId, organizationId);
    if (!instance) {
      throw new AppException(ERROR_CODES.WORKFLOW_INSTANCE_NOT_FOUND);
    }

    const fromStatus = instance.currentStatus;
    const allowed = ALLOWED_TRANSITIONS[fromStatus];

    if (!allowed.includes(toStatus)) {
      throw new AppException(ERROR_CODES.WORKFLOW_TRANSITION_INVALID, {
        message: `Cannot transition from '${fromStatus}' to '${toStatus}'`,
      });
    }

    const completedAt = toStatus === 'locked' ? new Date() : null;
    await this.instances.updateStatus(instanceId, toStatus, completedAt);

    await this.events.record({
      workflowInstanceId: instanceId,
      fromStatus,
      toStatus,
      actorId: ctx.userId ?? null,
      comment: comment ?? null,
    });

    await this.audit.record({
      module: 'workflows',
      action: 'transition',
      entityType: instance.targetType,
      entityId: instance.targetId,
      before: { status: fromStatus },
      after: { status: toStatus, comment: comment ?? null },
      ctx,
    });

    return this.toView({ ...instance, currentStatus: toStatus, completedAt });
  }

  async getHistory(instanceId: string, organizationId: string): Promise<WorkflowEventView[]> {
    const instance = await this.instances.findById(instanceId, organizationId);
    if (!instance) {
      throw new AppException(ERROR_CODES.WORKFLOW_INSTANCE_NOT_FOUND);
    }

    const raw = await this.events.listByInstance(instanceId);
    return raw.map((event) => this.toEventView(event));
  }

  /**
   * Guard consommé par d'autres modules : lève `WORKFLOW_LOCKED` si l'objet
   * cible a un workflow en état `locked`.  Les modules qui n'ont pas encore
   * de workflow démarré passent silencieusement.
   */
  async assertNotLocked(
    organizationId: string,
    targetType: WorkflowTargetType,
    targetId: string,
  ): Promise<void> {
    const instance = await this.instances.findByTarget(organizationId, targetType, targetId);
    if (instance?.currentStatus === 'locked') {
      throw new AppException(ERROR_CODES.WORKFLOW_LOCKED, {
        message: `${targetType} '${targetId}' is locked and cannot be modified`,
      });
    }
  }

  private toView(instance: WorkflowInstanceEntity): WorkflowInstanceView {
    return {
      id: instance.id,
      organizationId: instance.organizationId,
      targetType: instance.targetType,
      targetId: instance.targetId,
      currentStatus: instance.currentStatus,
      startedBy: instance.startedBy,
      startedAt: instance.startedAt,
      completedAt: instance.completedAt,
    };
  }

  private toEventView(event: WorkflowEventEntity): WorkflowEventView {
    return {
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorId: event.actorId,
      comment: event.comment,
      occurredAt: event.occurredAt,
    };
  }
}
