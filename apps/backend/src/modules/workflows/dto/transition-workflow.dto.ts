import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import type { WorkflowStatus } from '../types/workflow.types';

const VALID_STATUSES: WorkflowStatus[] = ['draft', 'in_review', 'approved', 'locked'];

export class TransitionWorkflowDto {
  @IsIn(VALID_STATUSES)
  toStatus!: WorkflowStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}
