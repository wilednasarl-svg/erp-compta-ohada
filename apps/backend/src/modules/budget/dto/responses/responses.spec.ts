import {
  BudgetAxisEnvelopeResponse,
  BudgetAxisResponse,
  BudgetImportReportResponse,
  BudgetImportRowErrorResponse,
  BudgetLineEnvelopeResponse,
  BudgetLineResponse,
  BudgetVarianceReportResponse,
  BudgetVarianceRowResponse,
  ListBudgetAxesResponse,
  ListBudgetLinesResponse,
} from './index';

/**
 * Garde-fou : les DTO de réponse Swagger doivent rester instanciables (les
 * décorateurs `@ApiProperty` s'exécutent à la définition de classe). Couvre
 * aussi les fichiers de réponse, sinon non exercés par les imports `type` des
 * mappers.
 */
describe('budget response DTOs', () => {
  it('instancie chaque classe de réponse', () => {
    const ctors = [
      BudgetAxisResponse,
      BudgetAxisEnvelopeResponse,
      ListBudgetAxesResponse,
      BudgetLineResponse,
      BudgetLineEnvelopeResponse,
      ListBudgetLinesResponse,
      BudgetVarianceRowResponse,
      BudgetVarianceReportResponse,
      BudgetImportRowErrorResponse,
      BudgetImportReportResponse,
    ];

    for (const Ctor of ctors) {
      expect(new Ctor()).toBeInstanceOf(Ctor);
    }
  });
});
