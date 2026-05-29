import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  DOCUMENT_TYPES,
  IMPORT_SOURCE_TYPES,
  type DocumentType,
  type ImportSourceType,
} from '../types/import-status';

/**
 * Body de `POST /organizations/:id/imports/sessions`.
 *
 * `sourceType` est obligatoire — il guide les dashboards et les
 * defaults de parsing (ex. encoding latin1 pour Sage). La détection
 * MIME au runtime reste l'autorité technique.
 *
 * `companyId` / `fiscalYear` sont libres (text) en attendant que
 * Module 2 vague 2 matérialise les entités correspondantes.
 */
export class CreateImportSessionDto {
  @ApiProperty({
    enum: IMPORT_SOURCE_TYPES as readonly string[],
    description: 'Type de source déclaré à la création',
  })
  @IsIn(IMPORT_SOURCE_TYPES as readonly string[])
  sourceType!: ImportSourceType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    description: 'Identifiant dossier comptable (placeholder)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  companyId?: string;

  @ApiPropertyOptional({ maxLength: 16, description: "Code exercice fiscal (ex. '2025')" })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  fiscalYear?: string;

  @ApiPropertyOptional({
    enum: DOCUMENT_TYPES as readonly string[],
    description:
      "Nature comptable du document (écritures, grand livre, balance, relevé bancaire, etc.). Guide l'auto-mapping.",
  })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES as readonly string[])
  documentType?: DocumentType;
}
