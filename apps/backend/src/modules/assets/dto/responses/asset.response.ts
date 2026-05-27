import { ApiProperty } from '@nestjs/swagger';

import {
  ASSET_STATUSES,
  DEPRECIATION_METHODS,
  type AssetStatus,
  type DepreciationMethod,
} from '../../types/asset.types';

/**
 * Réponse API pour une immobilisation. Forme alignée sur la
 * sérialisation TypeORM historique de `AssetEntity` (sans relations).
 * Tous les montants DECIMAL(15,2) sortent en `string` — le client doit
 * parser explicitement.
 */
export class AssetResponse {
  @ApiProperty({ description: 'UUID de l\'immobilisation', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'UUID de l\'organisation', format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ description: 'Code interne de l\'immobilisation', type: String })
  code!: string;

  @ApiProperty({ description: 'Libellé', type: String })
  label!: string;

  @ApiProperty({ description: 'Date d\'acquisition (YYYY-MM-DD)', type: String })
  acquisitionDate!: string;

  @ApiProperty({ description: 'Date de mise en service (YYYY-MM-DD)', type: String })
  putInServiceDate!: string;

  @ApiProperty({ description: 'Coût d\'acquisition. DECIMAL(15,2) en string.', type: String })
  acquisitionCost!: string;

  @ApiProperty({ description: 'Valeur résiduelle. DECIMAL(15,2) en string.', type: String })
  residualValue!: string;

  @ApiProperty({ description: 'Méthode d\'amortissement', enum: DEPRECIATION_METHODS })
  depreciationMethod!: DepreciationMethod;

  @ApiProperty({ description: 'Durée d\'amortissement en mois', type: Number })
  durationMonths!: number;

  @ApiProperty({
    description: 'Taux dégressif (NUMERIC(6,4) en string, null si méthode linéaire)',
    nullable: true,
    type: String,
  })
  decliningRate!: string | null;

  @ApiProperty({ description: 'UUID du compte d\'immobilisation (21x/22x/23x)', format: 'uuid' })
  assetAccountId!: string;

  @ApiProperty({ description: 'UUID du compte d\'amortissement cumulé (28x)', format: 'uuid' })
  depreciationAccountId!: string;

  @ApiProperty({ description: 'UUID du compte de dotation (681x)', format: 'uuid' })
  expenseAccountId!: string;

  @ApiProperty({ description: 'Statut de l\'immobilisation', enum: ASSET_STATUSES })
  status!: AssetStatus;

  @ApiProperty({
    description: 'Date de cession/mise au rebut (YYYY-MM-DD)',
    nullable: true,
    type: String,
  })
  disposalDate!: string | null;

  @ApiProperty({
    description: 'Valeur de cession. DECIMAL(15,2) en string.',
    nullable: true,
    type: String,
  })
  disposalValue!: string | null;

  // ─── W4.3 — UOP (Units Of Production) ─────────────────────────────
  @ApiProperty({
    description: 'W4.3 — Unités totales prévues (méthode UOP)',
    nullable: true,
    type: String,
  })
  totalUnits!: string | null;

  @ApiProperty({
    description: 'W4.3 — Unités par exercice (méthode UOP)',
    nullable: true,
    type: [Number],
  })
  unitsPerYear!: number[] | null;

  // ─── W4.3 — Amortissements dérogatoires ──────────────────────────
  @ApiProperty({ description: 'W4.3 — Amortissement dérogatoire activé', type: Boolean })
  derogatoryEnabled!: boolean;

  @ApiProperty({
    description: 'W4.3 — Méthode fiscale dérogatoire',
    nullable: true,
    enum: DEPRECIATION_METHODS,
  })
  derogatoryFiscalMethod!: DepreciationMethod | null;

  @ApiProperty({
    description: 'W4.3 — Durée fiscale dérogatoire (mois)',
    nullable: true,
    type: Number,
  })
  derogatoryFiscalDuration!: number | null;

  @ApiProperty({
    description: 'W4.3 — Taux fiscal dérogatoire',
    nullable: true,
    type: String,
  })
  derogatoryFiscalDecliningRate!: string | null;

  @ApiProperty({
    description: 'UUID du créateur',
    nullable: true,
    type: String,
    format: 'uuid',
  })
  createdById!: string | null;

  @ApiProperty({ description: 'Date de création', type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ description: 'Date de modification', type: String, format: 'date-time' })
  updatedAt!: Date;
}
