import { ApiProperty } from '@nestjs/swagger';

import type { TvaDeclarationLineDirection } from '../../types/tva.types';

const TVA_LINE_DIRECTIONS: ReadonlyArray<TvaDeclarationLineDirection> = [
  'collected',
  'deductible_bs',
  'deductible_immo',
];

/**
 * Réponse API pour une ligne de déclaration TVA.
 *
 * Contrat OpenAPI explicite — ne PAS retourner directement l'entité
 * TypeORM pour éviter les fuites de colonnes internes et garantir un
 * schéma stable côté frontend.
 */
export class TvaDeclarationLineResponse {
  @ApiProperty({
    description: 'Identifiant UUID v4 de la ligne',
    format: 'uuid',
    example: 'b1e8b9b0-7d4e-4f3a-9c2a-1e3f4a5b6c7d',
  })
  id!: string;

  @ApiProperty({
    description: 'Identifiant UUID v4 de la déclaration parente',
    format: 'uuid',
  })
  declarationId!: string;

  @ApiProperty({
    description: 'Sens d\'agrégation TVA (collectée / déductible biens & services / déductible immo)',
    enum: TVA_LINE_DIRECTIONS,
  })
  direction!: TvaDeclarationLineDirection;

  @ApiProperty({
    description: 'Préfixe de compte SYSCOHADA utilisé pour l\'agrégation (ex 443, 4452, 4451)',
    example: '4452',
  })
  accountPrefix!: string;

  @ApiProperty({
    description: 'Libellé du compte agrégé (peut être null)',
    nullable: true,
    type: String,
    example: 'TVA déductible sur biens et services',
  })
  accountLabel!: string | null;

  @ApiProperty({
    description:
      'Montant agrégé pour la ligne. DECIMAL(15,2) lu en string pour préserver la précision.',
    type: String,
    example: '125000.00',
  })
  amount!: string;

  @ApiProperty({
    description: 'Date de création de la ligne (ISO 8601)',
    type: String,
    format: 'date-time',
  })
  createdAt!: Date;
}
