import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import {
  COLLABORATION_STATUS_VALUES,
  type CollaborationStatus,
} from '../types/collaboration-status';

/**
 * `GET /collaboration/requests` query params. Le scope (cabinet vs
 * client) est dérivé du rôle JWT côté controller — il n'est pas
 * exposé ici pour empêcher un client de réquérir le scope cabinet.
 */
export class ListCollaborationRequestsQueryDto {
  @IsOptional()
  @IsIn(COLLABORATION_STATUS_VALUES as ReadonlyArray<string>)
  status?: CollaborationStatus;

  @IsOptional()
  @IsUUID('4')
  assigneeId?: string;

  @IsOptional()
  @IsUUID('4')
  requesterId?: string;

  @IsOptional()
  @IsUUID('4')
  linkedEntryId?: string;

  @IsOptional()
  @IsUUID('4')
  linkedDocumentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
