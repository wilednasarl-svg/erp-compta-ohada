import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Patch DTO du profile DSF — tous les champs sont optionnels pour
 * permettre la mise à jour incrémentale (les Fiches R1 à R4 se
 * remplissent progressivement à mesure que l'expert-comptable collecte
 * l'information auprès de son client).
 *
 * Les payloads JSONB (`notesApplicable`, `workforceByQualification`)
 * sont validés au shape par décorateur + au contenu par les setters
 * dans le service.
 */
export class UpdateDsfProfileDto {
  @ApiPropertyOptional({ example: 'SA', description: 'Forme juridique (SA, SARL, SAS, GIE, ...)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  legalForm?: string;

  @ApiPropertyOptional({ example: 'IS', description: 'Régime fiscal (BIC/BNC/IS/réel/simplifié)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxRegime?: string;

  @ApiPropertyOptional({ example: 'CIV', description: 'Code pays ISO 3166-1 alpha-3' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'country must be a 3-letter uppercase ISO code' })
  country?: string;

  @ApiPropertyOptional({
    example: '1234567890123',
    description: 'NINEA / IFU / identifiant fiscal',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ninea?: string;

  @ApiPropertyOptional({ example: 'CI-ABJ-2024-B-1234' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  rccm?: string;

  @ApiPropertyOptional({ example: 'Plateau, Rue du Commerce, Imm. Atlantis 3e ét.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  siegeAddress?: string;

  @ApiPropertyOptional({ example: 'Abidjan' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  siegeCity?: string;

  @ApiPropertyOptional({ example: '+225 27 20 30 40 50' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @ApiPropertyOptional({ example: 'contact@example.ci' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    example: '10000000.00',
    description: 'Capital social libéré (string décimal)',
  })
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'capital must be a decimal string' })
  capital?: string;

  @ApiPropertyOptional({ example: 'XOF', description: 'Devise ISO 4217 alpha-3' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter uppercase ISO code' })
  currency?: string;

  @ApiPropertyOptional({ example: 'Commerce de gros' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  activitySector?: string;

  @ApiPropertyOptional({ example: 'Yobonou Kassio' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  directorName?: string;

  @ApiPropertyOptional({ example: 'Directeur Général' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  directorTitle?: string;

  @ApiPropertyOptional({ example: 'M. Diakité' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  presidentName?: string;

  @ApiPropertyOptional({ example: 'Cabinet Bilan & Audit' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  auditorName?: string;

  /**
   * Carte d'applicabilité des notes annexes. Le service valide que
   * chaque clé matche le pattern `^N\d+[A-Z]?$` et que la valeur est
   * un booléen ; class-validator n'a pas d'introspection Record native.
   */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'boolean' },
    example: { N1: true, N2: true, N5: false },
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  notesApplicable?: Record<string, boolean>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: { 'YA cadres': 5, 'YB maîtrise': 12 },
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  workforceByQualification?: Record<string, number>;
}

/**
 * Garde runtime pour valider proprement les payloads JSONB. Lancée
 * par le service avant l'écriture.
 */
export function assertValidNotesApplicable(
  value: unknown,
): asserts value is Record<string, boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('notesApplicable must be a plain object of boolean values');
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (!/^N\d+[A-Z]?$/.test(key)) {
      throw new Error(`Invalid note id "${key}" — expected pattern ^N\\d+[A-Z]?$`);
    }
    if (typeof val !== 'boolean') {
      throw new Error(`Note "${key}" must map to a boolean (got ${typeof val})`);
    }
  }
}

export function assertValidWorkforce(value: unknown): asserts value is Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('workforceByQualification must be a plain object of integers');
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key.trim().length === 0) {
      throw new Error('workforceByQualification keys cannot be empty');
    }
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      throw new Error(`Qualification "${key}" must map to a non-negative integer`);
    }
  }
}

// Suppress unused-import warnings when class-validator emits decorators at
// build time but the tree-shaker doesn't see runtime usage; both helpers
// (`IsInt`, `Min`, `Max`) are reserved for future tightening of nested
// Record validation when class-validator adds first-class support.
void IsInt;
void Min;
void Max;
void IsBoolean;
