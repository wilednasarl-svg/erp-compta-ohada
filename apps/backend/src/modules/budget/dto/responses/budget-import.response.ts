import { ApiProperty } from '@nestjs/swagger';

/** Erreur de validation rattachée à une ligne du fichier importé. */
export class BudgetImportRowErrorResponse {
  @ApiProperty({
    example: 7,
    description: 'Numéro de ligne dans le fichier (1 = 1re ligne de données)',
  })
  row!: number;

  @ApiProperty({ type: [String], description: 'Messages de validation pour cette ligne' })
  messages!: string[];
}

/** Bilan d'un import budgétaire. */
export class BudgetImportReportResponse {
  @ApiProperty({ example: 120, description: 'Nombre de lignes de données lues' })
  totalRows!: number;

  @ApiProperty({ example: 95, description: 'Lignes créées' })
  created!: number;

  @ApiProperty({ example: 20, description: 'Lignes mises à jour (clé naturelle existante)' })
  updated!: number;

  @ApiProperty({ example: 5, description: 'Lignes rejetées (erreurs de validation)' })
  skipped!: number;

  @ApiProperty({ type: () => [BudgetImportRowErrorResponse] })
  errors!: BudgetImportRowErrorResponse[];
}
