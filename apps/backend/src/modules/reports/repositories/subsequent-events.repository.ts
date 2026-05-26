import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import {
  SubsequentEventEntity,
  type SubsequentEventClassification,
} from '../entities/subsequent-event.entity';

export interface CreateSubsequentEventInput {
  readonly organizationId: TenantId | string;
  readonly exerciseId: string;
  readonly eventDate: string;
  readonly classification: SubsequentEventClassification;
  readonly description: string;
  readonly financialImpact: string | null;
  readonly journalEntryId: string | null;
  readonly createdById: string;
}

export interface UpdateSubsequentEventInput {
  readonly eventDate?: string;
  readonly classification?: SubsequentEventClassification;
  readonly description?: string;
  readonly financialImpact?: string | null;
  readonly journalEntryId?: string | null;
}

/**
 * `SubsequentEventsRepository` — accès à la table `subsequent_events`
 * (W5.7). Toutes les méthodes scopent sur `organizationId`.
 */
@Injectable()
export class SubsequentEventsRepository {
  constructor(
    @InjectRepository(SubsequentEventEntity)
    private readonly repo: Repository<SubsequentEventEntity>,
  ) {}

  async create(input: CreateSubsequentEventInput): Promise<SubsequentEventEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      exerciseId: input.exerciseId,
      eventDate: input.eventDate,
      classification: input.classification,
      description: input.description,
      financialImpact: input.financialImpact,
      journalEntryId: input.journalEntryId,
      createdById: input.createdById,
      reviewedById: null,
      reviewedAt: null,
    });
    return this.repo.save(entity);
  }

  async findById(
    organizationId: TenantId | string,
    id: string,
  ): Promise<SubsequentEventEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, id } });
  }

  async listByExercise(
    organizationId: TenantId | string,
    exerciseId: string,
  ): Promise<ReadonlyArray<SubsequentEventEntity>> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, exerciseId },
      order: { eventDate: 'ASC' },
    });
  }

  async update(
    organizationId: TenantId | string,
    id: string,
    patch: UpdateSubsequentEventInput,
  ): Promise<SubsequentEventEntity | null> {
    assertTenantId(organizationId);
    const existing = await this.repo.findOne({ where: { organizationId, id } });
    if (!existing) return null;
    if (patch.eventDate !== undefined) existing.eventDate = patch.eventDate;
    if (patch.classification !== undefined) existing.classification = patch.classification;
    if (patch.description !== undefined) existing.description = patch.description;
    if (patch.financialImpact !== undefined) existing.financialImpact = patch.financialImpact;
    if (patch.journalEntryId !== undefined) existing.journalEntryId = patch.journalEntryId;
    return this.repo.save(existing);
  }

  async markReviewed(
    organizationId: TenantId | string,
    id: string,
    reviewerId: string,
  ): Promise<SubsequentEventEntity | null> {
    assertTenantId(organizationId);
    const existing = await this.repo.findOne({ where: { organizationId, id } });
    if (!existing) return null;
    existing.reviewedById = reviewerId;
    existing.reviewedAt = new Date();
    return this.repo.save(existing);
  }

  async delete(organizationId: TenantId | string, id: string): Promise<boolean> {
    assertTenantId(organizationId);
    const res = await this.repo.delete({ organizationId, id });
    return (res.affected ?? 0) > 0;
  }
}
