import { ApiProperty } from '@nestjs/swagger';

import { TvaCodeResponse } from './tva-code.response';

/**
 * Enveloppe de réponse pour un code TVA unique.
 */
export class TvaCodeEnvelopeResponse {
  @ApiProperty({
    description: 'Code TVA',
    type: () => TvaCodeResponse,
  })
  code!: TvaCodeResponse;
}
