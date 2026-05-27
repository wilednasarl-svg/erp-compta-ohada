import { ApiProperty } from '@nestjs/swagger';

const DISPOSAL_ENTRY_TYPES = [
  'prorata_depreciation',
  'asset_writeoff',
  'disposal_proceeds',
] as const;
export type DisposalEntryType = (typeof DISPOSAL_ENTRY_TYPES)[number];

export class DisposalJournalEntryLineResponse {
  @ApiProperty({ description: 'Code SYSCOHADA du compte', type: String })
  accountCode!: string;

  @ApiProperty({ description: 'Montant débit (number, pas string DECIMAL)', type: Number })
  debit!: number;

  @ApiProperty({ description: 'Montant crédit (number, pas string DECIMAL)', type: Number })
  credit!: number;
}

/**
 * Récapitulatif d'une écriture comptable générée par la cession d'un
 * asset (`POST /assets/:id/dispose`). Forme alignée sur
 * `DisposalJournalEntrySummary` (cf. AssetsService).
 */
export class DisposalJournalEntryResponse {
  @ApiProperty({ description: 'UUID de l\'écriture journal', format: 'uuid' })
  id!: string;

  @ApiProperty({
    description:
      'Type d\'écriture générée par la cession : dotation prorata, sortie de l\'actif, produit de cession',
    enum: DISPOSAL_ENTRY_TYPES,
  })
  type!: DisposalEntryType;

  @ApiProperty({
    description: 'Lignes débit/crédit de l\'écriture (montants en number)',
    type: () => [DisposalJournalEntryLineResponse],
  })
  lines!: DisposalJournalEntryLineResponse[];
}
