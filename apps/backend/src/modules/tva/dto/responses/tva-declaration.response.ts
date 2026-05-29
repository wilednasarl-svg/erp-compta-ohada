import { ApiProperty } from '@nestjs/swagger';

import type { TvaDeclarationStatus } from '../../types/tva.types';
import { TvaDeclarationLineResponse } from './tva-declaration-line.response';

const TVA_DECLARATION_STATUSES: ReadonlyArray<TvaDeclarationStatus> = [
  'draft',
  'calculated',
  'cancelled',
];

/**
 * Réponse API pour une déclaration TVA mensuelle.
 *
 * Contrat OpenAPI explicite — c'est la source de vérité pour la forme
 * exposée au frontend. Les montants DECIMAL(15,2) TypeORM sortent en
 * string : le client doit parser explicitement.
 */
export class TvaDeclarationResponse {
  @ApiProperty({
    description: 'Identifiant UUID v4 de la déclaration',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: "Identifiant UUID v4 de l'organisation propriétaire",
    format: 'uuid',
  })
  organizationId!: string;

  @ApiProperty({
    description: 'Année de la période fiscale (ex 2026)',
    type: Number,
    example: 2026,
  })
  periodYear!: number;

  @ApiProperty({
    description: 'Mois de la période fiscale (1-12)',
    type: Number,
    minimum: 1,
    maximum: 12,
    example: 5,
  })
  periodMonth!: number;

  @ApiProperty({
    description: 'Statut de la déclaration',
    enum: TVA_DECLARATION_STATUSES,
  })
  status!: TvaDeclarationStatus;

  @ApiProperty({
    description: 'TVA collectée totale. DECIMAL(15,2) en string.',
    type: String,
    example: '1850000.00',
  })
  tvaCollecteeTotal!: string;

  @ApiProperty({
    description: 'TVA déductible biens & services. DECIMAL(15,2) en string.',
    type: String,
    example: '420000.00',
  })
  tvaDeductibleBsTotal!: string;

  @ApiProperty({
    description: 'TVA déductible sur immobilisations. DECIMAL(15,2) en string.',
    type: String,
    example: '180000.00',
  })
  tvaDeductibleImmoTotal!: string;

  @ApiProperty({
    description:
      'TVA à décaisser = collectée - (déductible_bs + déductible_immo) si positif, 0 sinon. DECIMAL(15,2) en string.',
    type: String,
    example: '1250000.00',
  })
  tvaADecaisser!: string;

  @ApiProperty({
    description:
      'Crédit TVA reportable = abs(collectée - déductible_total) si négatif, 0 sinon. DECIMAL(15,2) en string.',
    type: String,
    example: '0.00',
  })
  creditTvaReportable!: string;

  @ApiProperty({
    description: 'Date de calcul de la déclaration (null si encore en draft)',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  computedAt!: Date | null;

  @ApiProperty({
    description: "UUID de l'utilisateur ayant calculé la déclaration",
    nullable: true,
    type: String,
    format: 'uuid',
  })
  computedById!: string | null;

  @ApiProperty({
    description: "Date d'annulation (null si non annulée)",
    nullable: true,
    type: String,
    format: 'date-time',
  })
  cancelledAt!: Date | null;

  @ApiProperty({
    description: "UUID de l'utilisateur ayant annulé la déclaration",
    nullable: true,
    type: String,
    format: 'uuid',
  })
  cancelledById!: string | null;

  @ApiProperty({
    description: "Motif d'annulation libre (null si non annulée)",
    nullable: true,
    type: String,
  })
  cancelledReason!: string | null;

  @ApiProperty({
    description:
      "UUID de l'écriture de journal OD générée par la centralisation TVA (W4.1). Null tant que la déclaration n'a pas été centralisée.",
    nullable: true,
    type: String,
    format: 'uuid',
  })
  centralizationJournalEntryId!: string | null;

  @ApiProperty({
    description:
      "Date à laquelle la centralisation TVA a été exécutée (W4.1). Null tant que la déclaration n'a pas été centralisée.",
    nullable: true,
    type: String,
    format: 'date-time',
  })
  centralizedAt!: Date | null;

  @ApiProperty({
    description: "Lignes d'agrégation par préfixe de compte SYSCOHADA",
    type: () => [TvaDeclarationLineResponse],
  })
  lines!: TvaDeclarationLineResponse[];
}
