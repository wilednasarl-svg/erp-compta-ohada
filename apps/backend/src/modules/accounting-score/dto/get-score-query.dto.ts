import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * GET /organizations/:id/accounting-score?exerciseId=...
 */
export class GetScoreQueryDto {
  @ApiProperty({
    description: 'Accounting period id whose latest score is requested',
    format: 'uuid',
  })
  @IsUUID('4')
  exerciseId!: string;
}
