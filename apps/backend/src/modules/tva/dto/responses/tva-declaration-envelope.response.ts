import { ApiProperty } from '@nestjs/swagger';

import { TvaDeclarationResponse } from './tva-declaration.response';

/**
 * Enveloppe de réponse pour une déclaration TVA unique.
 *
 * Le shape `{ declaration: {...} }` est conservé pour ne pas casser
 * les clients existants. Le bug 2026-05-25 venait du fait que ce
 * contrat n'était PAS exposé en OpenAPI — le frontend devinait les
 * noms de champs.
 */
export class TvaDeclarationEnvelopeResponse {
  @ApiProperty({
    description: 'Déclaration TVA',
    type: () => TvaDeclarationResponse,
  })
  declaration!: TvaDeclarationResponse;
}
