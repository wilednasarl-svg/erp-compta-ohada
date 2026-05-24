import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WorkflowInstanceEntity } from '../entities/workflow-instance.entity';
import type { WorkflowStatus, WorkflowTargetType } from '../types/workflow.types';

export interface CreateInstanceInput {
  readonly workflowDefinitionId: string;
  readonly organizationId: string;
  readonly targetType: WorkflowTargetType;
  readonly targetId: string;
  readonly startedBy: string | null;
}

@Injectable()
export class WorkflowInstanceRepository {
  constructor(
    @InjectRepository(WorkflowInstanceEntity)
    private readonly repo: Repository<WorkflowInstanceEntity>,
  ) {}

  create(input: CreateInstanceInput): Promise<WorkflowInstanceEntity> {
    const instance = this.repo.create({
      workflowDefinitionId: input.workflowDefinitionId,
      organizationId: input.organizationId,
      targetType: input.targetType,
      targetId: input.targetId,
      currentStatus: 'draft',
      startedBy: input.startedBy,
    });
    return this.repo.save(instance);
  }

  findById(id: string, organizationId: string): Promise<WorkflowInstanceEntity | null> {
    return this.repo.findOne({ where: { id, organizationId } });
  }

  findByTarget(
    organizationId: string,
    targetType: WorkflowTargetType,
    targetId: string,
  ): Promise<WorkflowInstanceEntity | null> {
    return this.repo.findOne({ where: { organizationId, targetType, targetId } });
  }

  async updateStatus(id: string, status: WorkflowStatus, completedAt?: Date | null): Promise<void> {
    const qb = this.repo
      .createQueryBuilder()
      .update()
      .set({ currentStatus: status })
      .where('id = :id', { id });

    if (completedAt !== undefined) {
      qb.set({ currentStatus: status, completedAt });
    }

    await qb.execute();
  }
}
