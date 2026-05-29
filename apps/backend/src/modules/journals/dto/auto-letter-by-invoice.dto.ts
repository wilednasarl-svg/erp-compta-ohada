import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * Corps optionnel du lettrage automatique par N° de facture. Sans
 * `partnerAccountId`, le batch balaye tous les comptes tiers (40/41/43/44)
 * de l'organisation ; fourni, il restreint à un seul compte.
 */
export class AutoLetterByInvoiceDto {
  @ApiPropertyOptional({
    description: 'UUID du compte tiers à lettrer (sinon tous les comptes 40/41/43/44).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  partnerAccountId?: string;
}
