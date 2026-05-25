import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { CollaborationCommentEntity } from '../entities/collaboration-comment.entity';

export interface CreateCommentInput {
  readonly organizationId: string;
  readonly requestId: string;
  readonly authorId: string;
  readonly body: string;
}

/**
 * `CollaborationCommentRepository` — couche persistante tenant-scoped
 * pour `collaboration_comments`.
 *
 * Le service est responsable de vérifier que la demande parente existe
 * et appartient au tenant courant AVANT d'écrire un commentaire — c'est
 * lui qui appelle aussi `assertTenantId`.
 */
@Injectable()
export class CollaborationCommentRepository {
  constructor(
    @InjectRepository(CollaborationCommentEntity)
    private readonly repo: Repository<CollaborationCommentEntity>,
  ) {}

  async createOne(input: CreateCommentInput): Promise<CollaborationCommentEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      requestId: input.requestId,
      authorId: input.authorId,
      body: input.body,
    });
    return this.repo.save(entity);
  }

  async listByRequest(
    organizationId: TenantId | string,
    requestId: string,
  ): Promise<CollaborationCommentEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, requestId },
      order: { createdAt: 'ASC' },
    });
  }
}
