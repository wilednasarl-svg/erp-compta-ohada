import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

import { DOCUMENT_TYPES, type DocumentType } from '../types/import-status';

/**
 * Body de `PATCH /organizations/:id/imports/sessions/:sessionId`.
 *
 * Patch partiel : seuls les champs fournis sont mis à jour. Au moins un
 * champ doit être présent (vérifié côté service avec une erreur 422
 * dédiée si le body est totalement vide).
 *
 * `label === null` (et non `undefined`) efface explicitement le libellé
 * — utile pour qu'un utilisateur revienne au libellé auto "Session <8c>".
 * `documentType === null` retire la nature comptable forcée et laisse
 * l'auto-détection s'appliquer à la prochaine preview.
 */
export class UpdateImportSessionDto {
  @ApiPropertyOptional({
    maxLength: 200,
    nullable: true,
    description: 'Libellé humain de la session (null pour effacer).',
  })
  @IsOptional()
  // Accept explicit null OR a string up to 200 chars. `@IsString()` alone
  // would reject null, so we gate the constraint behind a custom guard.
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  label?: string | null;

  @ApiPropertyOptional({
    enum: DOCUMENT_TYPES as readonly string[],
    nullable: true,
    description:
      'Nature comptable du document (null pour repasser en auto-détection). Interdit après commit.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(DOCUMENT_TYPES as readonly string[])
  documentType?: DocumentType | null;

  @ApiPropertyOptional({
    maxLength: 16,
    nullable: true,
    description:
      'Code journal par défaut appliqué aux lignes sans colonne journal (null pour le retirer).',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(16)
  defaultJournalCode?: string | null;
}
