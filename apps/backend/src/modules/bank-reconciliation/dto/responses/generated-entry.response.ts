import { ApiProperty } from '@nestjs/swagger';

/** Résultat de la comptabilisation + rapprochement d'une ligne de relevé. */
export class GeneratedEntryResponse {
  @ApiProperty({ description: "Id de l'écriture créée et validée" })
  entryId!: string;

  @ApiProperty({ type: Number, description: "Numéro de l'écriture dans le journal" })
  entryNumber!: number;

  @ApiProperty({ description: 'Id de la ligne d’écriture (compte banque) rapprochée' })
  bankJournalEntryLineId!: string;

  @ApiProperty({ description: 'Id du rapprochement créé' })
  matchId!: string;

  @ApiProperty({ enum: ['outflow', 'inflow'], description: 'Sens de l’opération' })
  direction!: 'outflow' | 'inflow';

  @ApiProperty({ type: Number, description: 'Montant comptabilisé (valeur absolue)' })
  absAmount!: number;
}
