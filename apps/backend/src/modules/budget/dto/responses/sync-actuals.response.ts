import { ApiProperty } from '@nestjs/swagger';

/** Compte rendu d'une synchronisation du réalisé budgétaire. */
export class SyncActualsResponse {
  @ApiProperty({ type: Number, description: 'Exercice synchronisé', example: 2026 })
  fiscalYear!: number;

  @ApiProperty({
    type: Number,
    description: 'Nombre de lignes réalisé (compte × mois) générées',
    example: 248,
  })
  linesCreated!: number;

  @ApiProperty({ type: Number, description: 'Nombre de comptes distincts touchés', example: 42 })
  accountsCount!: number;

  @ApiProperty({
    type: String,
    description: 'Total réalisé orienté (base XOF)',
    example: '18450000.00',
  })
  totalActual!: string;
}
