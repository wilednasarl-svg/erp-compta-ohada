import { ApiProperty } from '@nestjs/swagger';

/**
 * Réponse API pour une ligne d'écriture comptable. Forme alignée sur
 * `EntryView.lines[]` (cf. EntriesService.buildView) — montants débit
 * et crédit sortent en string DECIMAL(15,2).
 */
export class JournalEntryLineResponse {
  @ApiProperty({ description: 'UUID de la ligne', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'UUID du compte référencé', format: 'uuid' })
  accountId!: string;

  @ApiProperty({ description: "Position 1-N de la ligne dans l'écriture", type: Number })
  position!: number;

  @ApiProperty({ description: 'Libellé libre de la ligne', nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ description: 'Montant débit. DECIMAL(15,2) en string.', type: String })
  debit!: string;

  @ApiProperty({ description: 'Montant crédit. DECIMAL(15,2) en string.', type: String })
  credit!: string;
}
