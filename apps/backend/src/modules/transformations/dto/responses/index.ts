import { ApiProperty } from '@nestjs/swagger';

import type {
  TransformationDiff,
  TransformationStatus,
  TransformationType,
} from '../../types/transformation.types';

export class TransformationSummaryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({
    description: 'reclassification | adjustment | correction | ventilation | grouping',
  })
  type!: TransformationType;
  @ApiProperty({ enum: ['active', 'cancelled'] })
  status!: TransformationStatus;
  @ApiProperty({ format: 'uuid' })
  sourceEntryId!: string;
  @ApiProperty({ type: 'object', description: 'Diff sparse des champs avant la transformation' })
  beforeValues!: TransformationDiff;
  @ApiProperty({ type: 'object', description: 'Diff sparse des champs après la transformation' })
  afterValues!: TransformationDiff;
  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;
  @ApiProperty({ format: 'uuid' })
  createdById!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cancelledAt!: Date | null;
  @ApiProperty({ nullable: true, type: String })
  cancelReason!: string | null;
}

export class TransformationEnvelopeResponse {
  @ApiProperty({ type: () => TransformationSummaryResponse })
  transformation!: TransformationSummaryResponse;
}

export class TransformationHistoryResponse {
  @ApiProperty({ type: () => [TransformationSummaryResponse] })
  history!: TransformationSummaryResponse[];
}
