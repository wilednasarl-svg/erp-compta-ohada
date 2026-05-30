import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { FISCAL_DECLARATION_STATUSES, type FiscalDeclarationStatus } from '../types/fiscal.types';

export class TransitionDeclarationDto {
  @ApiProperty({ enum: FISCAL_DECLARATION_STATUSES as readonly string[], example: 'depose' })
  @IsIn(FISCAL_DECLARATION_STATUSES as readonly string[])
  targetStatus!: FiscalDeclarationStatus;
}
