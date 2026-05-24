import { IsIn, IsUUID } from 'class-validator';

import type { WorkflowTargetType } from '../types/workflow.types';

const SUPPORTED_TARGET_TYPES: WorkflowTargetType[] = ['import_session'];

export class StartWorkflowDto {
  @IsIn(SUPPORTED_TARGET_TYPES)
  targetType!: WorkflowTargetType;

  @IsUUID()
  targetId!: string;
}
