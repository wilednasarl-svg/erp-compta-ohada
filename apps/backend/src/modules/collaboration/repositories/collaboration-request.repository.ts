import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { CollaborationRequestEntity } from '../entities/collaboration-request.entity';
import type { CollaborationStatus } from '../types/collaboration-status';

/**
 * Filtres consommés par `listForOrg`. Tous optionnels — combinés en AND.
 * `assigneeId` est exploité par le scope client (cf. service) pour ne
 * remonter que les demandes assignées à l'utilisateur courant.
 */
export interface CollaborationRequestListFilters {
  readonly status?: CollaborationStatus;
  readonly assigneeId?: string;
  readonly requesterId?: string;
  readonly linkedEntryId?: string;
  readonly linkedDocumentId?: string;
}

export interface PaginationOptions {
  readonly page: number;
  readonly pageSize: number;
}

export interface PaginatedRequests {
  readonly rows: ReadonlyArray<CollaborationRequestEntity>;
  readonly total: number;
}

export interface CreateRequestInput {
  readonly organizationId: string;
  readonly requesterId: string;
  readonly assigneeId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly linkedEntryId: string | null;
  readonly linkedDocumentId: string | null;
  readonly dueDate: string | null;
}

export interface UpdateStatusInput {
  readonly status: CollaborationStatus;
  readonly completedAt: Date | null;
  readonly completedBy: string | null;
}

/**
 * `CollaborationRequestRepository` — couche persistante tenant-scoped
 * pour `collaboration_requests`.
 *
 * Chaque méthode publique prend `organizationId` et passe par
 * `assertTenantId` AVANT toute requête. Aucun champ deleted_at en wave 1
 * (les demandes complétées / annulées restent visibles dans l'historique).
 */
@Injectable()
export class CollaborationRequestRepository {
  constructor(
    @InjectRepository(CollaborationRequestEntity)
    private readonly repo: Repository<CollaborationRequestEntity>,
  ) {}

  async findById(
    organizationId: TenantId | string,
    id: string,
  ): Promise<CollaborationRequestEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async createOne(input: CreateRequestInput): Promise<CollaborationRequestEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      requesterId: input.requesterId,
      assigneeId: input.assigneeId,
      status: 'open',
      title: input.title,
      description: input.description,
      linkedEntryId: input.linkedEntryId,
      linkedDocumentId: input.linkedDocumentId,
      dueDate: input.dueDate,
      completedAt: null,
      completedBy: null,
    });
    return this.repo.save(entity);
  }

  async updateStatus(
    organizationId: TenantId | string,
    id: string,
    input: UpdateStatusInput,
  ): Promise<boolean> {
    assertTenantId(organizationId);
    const result = await this.repo
      .createQueryBuilder()
      .update(CollaborationRequestEntity)
      .set({
        status: input.status,
        completedAt: input.completedAt,
        completedBy: input.completedBy,
      })
      .where('id = :id', { id })
      .andWhere('organization_id = :organizationId', { organizationId })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async listForOrg(
    organizationId: TenantId | string,
    filters: CollaborationRequestListFilters,
    pagination: PaginationOptions,
  ): Promise<PaginatedRequests> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('req')
      .where('req.organization_id = :organizationId', { organizationId });

    if (filters.status !== undefined) {
      qb.andWhere('req.status = :status', { status: filters.status });
    }
    if (filters.assigneeId !== undefined) {
      qb.andWhere('req.assignee_id = :assigneeId', { assigneeId: filters.assigneeId });
    }
    if (filters.requesterId !== undefined) {
      qb.andWhere('req.requester_id = :requesterId', { requesterId: filters.requesterId });
    }
    if (filters.linkedEntryId !== undefined) {
      qb.andWhere('req.linked_entry_id = :linkedEntryId', {
        linkedEntryId: filters.linkedEntryId,
      });
    }
    if (filters.linkedDocumentId !== undefined) {
      qb.andWhere('req.linked_document_id = :linkedDocumentId', {
        linkedDocumentId: filters.linkedDocumentId,
      });
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('req.created_at', 'DESC')
      .skip((pagination.page - 1) * pagination.pageSize)
      .take(pagination.pageSize)
      .getMany();

    return { rows, total };
  }
}
