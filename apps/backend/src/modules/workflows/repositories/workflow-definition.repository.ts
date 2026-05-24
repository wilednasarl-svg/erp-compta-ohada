import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WorkflowDefinitionEntity } from '../entities/workflow-definition.entity';
import type { WorkflowTargetType } from '../types/workflow.types';

@Injectable()
export class WorkflowDefinitionRepository {
  constructor(
    @InjectRepository(WorkflowDefinitionEntity)
    private readonly repo: Repository<WorkflowDefinitionEntity>,
  ) {}

  findActiveByTargetType(targetType: WorkflowTargetType): Promise<WorkflowDefinitionEntity | null> {
    return this.repo.findOne({ where: { targetType, isActive: true } });
  }
}
