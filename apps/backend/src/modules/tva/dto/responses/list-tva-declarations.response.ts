import { ApiProperty } from '@nestjs/swagger';

import { TvaDeclarationResponse } from './tva-declaration.response';

/**
 * Enveloppe de réponse pour le listing des déclarations TVA.
 *
 * Le shape `{ declarations: [...] }` est conservé pour ne pas casser
 * les clients existants — c'est le contrat OpenAPI qui devient explicite.
 */
export class ListTvaDeclarationsResponse {
  @ApiProperty({
    description: "Liste des déclarations TVA pour l'organisation",
    type: () => [TvaDeclarationResponse],
  })
  declarations!: TvaDeclarationResponse[];
}
