import { ApiProperty } from '@nestjs/swagger';

import type { TvaCodeKind, TvaCodeType } from '../../types/tva.types';

const TVA_TYPES: ReadonlyArray<TvaCodeType> = ['sales', 'purchase', 'both'];
const TVA_KINDS: ReadonlyArray<TvaCodeKind> = [
  'normal',
  'reduced',
  'exempt',
  'exonerated',
  'export',
];

/**
 * Réponse API pour un code TVA du catalogue organisationnel.
 *
 * Contrat OpenAPI explicite. Le taux DECIMAL(5,2) sort en string pour
 * préserver la précision (ne pas convertir en number côté client sans
 * passer par une lib decimal).
 */
export class TvaCodeResponse {
  @ApiProperty({
    description: 'Identifiant UUID v4 du code TVA',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: "Identifiant UUID v4 de l'organisation propriétaire",
    format: 'uuid',
  })
  organizationId!: string;

  @ApiProperty({
    description: 'Code court (lettres maj, chiffres, tirets ; 1-16 chars)',
    example: 'TVA-N-18',
  })
  code!: string;

  @ApiProperty({
    description: 'Libellé descriptif',
    example: 'TVA Normale 18% (taux standard CI)',
  })
  label!: string;

  @ApiProperty({
    description: 'Taux TVA (0.00 → 99.99). DECIMAL(5,2) en string.',
    type: String,
    example: '18.00',
  })
  rate!: string;

  @ApiProperty({
    description: 'Direction du code (ventes / achats / les deux)',
    enum: TVA_TYPES,
  })
  type!: TvaCodeType;

  @ApiProperty({
    description: 'Nature fiscale du code',
    enum: TVA_KINDS,
  })
  kind!: TvaCodeKind;

  @ApiProperty({
    description: 'Code actif (utilisable sur de nouvelles écritures)',
    type: Boolean,
  })
  isActive!: boolean;

  @ApiProperty({
    description: 'Date de création (ISO 8601)',
    type: String,
    format: 'date-time',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Date de dernière mise à jour (ISO 8601)',
    type: String,
    format: 'date-time',
  })
  updatedAt!: Date;
}
