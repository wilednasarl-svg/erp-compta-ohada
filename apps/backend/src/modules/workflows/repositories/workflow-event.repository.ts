import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WorkflowEventEntity } from '../entities/workflow-event.entity';
import type { WorkflowStatus } from '../types/workflow.types';

export interface CreateEventInput {
  readonly workflowInstanceId: string;
  readonly fromStatus: WorkflowStatus | null;
  readonly toStatus: WorkflowStatus;
  readonly actorId: string | null;
  readonly comment: string | null;
}

@Injectable()
export class WorkflowEventRepository {
  constructor(
    @InjectRepository(WorkflowEventEntity)
    private readonly repo: Repository<WorkflowEventEntity>,
  ) {}

  record(input: CreateEventInput): Promise<WorkflowEventEntity> {
    const event = this.repo.create({
      workflowInstanceId: input.workflowInstanceId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorId: input.actorId,
      comment: input.comment,
    });
    return this.repo.save(event);
  }

  listByInstance(workflowInstanceId: string): Promise<WorkflowEventEntity[]> {
    return this.repo.find({
      where: { workflowInstanceId },
      order: { occurredAt: 'ASC' },
    });
  }
}
