import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class ReclassifyEntryDto {
  @IsUUID()
  sourceEntryId!: string;

  /** Nouveau code compte OHADA (ex: "4111"). Optionnel si seul journal change. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  account?: string;

  /** Nouveau code journal (ex: "VTE"). Optionnel. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  journal?: string;

  /** Nouveau code tiers. Optionnel. */
  @IsOptional()
  @IsString()
  partner?: string;

  /** Nouveau libellé. Optionnel. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  /** Raison / note de la transformation (conservée dans l'audit). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  notes?: string;
}
