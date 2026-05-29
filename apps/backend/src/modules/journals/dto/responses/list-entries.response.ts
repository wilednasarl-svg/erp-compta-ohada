import { ApiProperty } from '@nestjs/swagger';

import { JournalEntryListItemResponse } from './journal-entry.response';

/**
 * Réponse paginée pour la liste des écritures (`GET /entries`).
 *
 * Forme `{ entries, total }` **préservée** depuis l'implémentation
 * pré-DTO (ce que le frontend consomme déjà) — c'est un refactor de
 * contrat, pas une refonte d'API.
 */
export class ListEntriesResponse {
  @ApiProperty({
    description: "En-têtes d'écritures de la page courante (sans les lignes)",
    type: () => [JournalEntryListItemResponse],
  })
  entries!: JournalEntryListItemResponse[];

  @ApiProperty({
    description: "Total absolu d'écritures pour les filtres courants (toutes pages confondues)",
    type: Number,
  })
  total!: number;
}
