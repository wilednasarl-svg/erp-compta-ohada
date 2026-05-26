import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * W3.5 — Payload de création d'un batch de régularisations.
 *
 * Le `reversalDate` est calculé automatiquement par le service
 * (`exerciseEndDate + 1 jour`), il n'est donc pas dans le DTO d'API.
 */
export class CreateBatchDto {
  /** Date de fin d'exercice (ISO YYYY-MM-DD). */
  @IsDateString()
  exerciseEndDate!: string;

  /** Libellé libre du batch (optionnel). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;
}
