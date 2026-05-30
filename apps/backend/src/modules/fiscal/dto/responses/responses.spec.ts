import {
  FiscalBracketResponse,
  FiscalDeclarationEnvelopeResponse,
  FiscalDeclarationResponse,
  FiscalParameterEnvelopeResponse,
  FiscalParameterResponse,
  ListFiscalBracketsResponse,
  ListFiscalDeclarationsResponse,
  ListFiscalParametersResponse,
  SeedDefaultsResultResponse,
} from './index';

/**
 * Garde-fou : les DTO de réponse Swagger doivent rester instanciables (les
 * décorateurs `@ApiProperty` s'exécutent à la définition de classe). Couvre
 * aussi les fichiers de réponse, sinon non exercés par les imports `type` des
 * mappers.
 */
describe('fiscal response DTOs', () => {
  it('instancie chaque classe de réponse', () => {
    const ctors = [
      FiscalParameterResponse,
      FiscalParameterEnvelopeResponse,
      ListFiscalParametersResponse,
      SeedDefaultsResultResponse,
      FiscalDeclarationResponse,
      FiscalDeclarationEnvelopeResponse,
      ListFiscalDeclarationsResponse,
      FiscalBracketResponse,
      ListFiscalBracketsResponse,
    ];

    for (const Ctor of ctors) {
      expect(new Ctor()).toBeInstanceOf(Ctor);
    }
  });
});
