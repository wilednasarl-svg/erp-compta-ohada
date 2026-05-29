import { ApiProperty } from '@nestjs/swagger';

import { TvaCodeResponse } from './tva-code.response';

/**
 * Enveloppe de réponse pour le listing des codes TVA.
 */
export class ListTvaCodesResponse {
  @ApiProperty({
    description: "Liste des codes TVA actifs/inactifs pour l'organisation",
    type: () => [TvaCodeResponse],
  })
  codes!: TvaCodeResponse[];
}
