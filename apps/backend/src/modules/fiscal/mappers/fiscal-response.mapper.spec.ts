import type { FiscalDeclarationEntity } from '../entities/fiscal-declaration.entity';
import type { FiscalParameterEntity } from '../entities/fiscal-parameter.entity';
import type { FiscalTaxBracketEntity } from '../entities/fiscal-tax-bracket.entity';
import {
  toFiscalBracketResponse,
  toFiscalDeclarationEnvelope,
  toFiscalDeclarationResponse,
  toFiscalParameterEnvelope,
  toFiscalParameterResponse,
  toListFiscalBrackets,
  toListFiscalDeclarations,
  toListFiscalParameters,
} from './fiscal-response.mapper';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function param(): FiscalParameterEntity {
  return {
    id: 'p1',
    organizationId: 'org1',
    taxCode: 'TVA',
    label: 'TVA',
    declarationKind: 'fiscal',
    rate: '18.0000',
    baseKind: 'vat_net',
    periodicity: 'monthly',
    ceiling: null,
    floorAmount: null,
    dueDay: 15,
    chargeAccount: '4434',
    liabilityAccount: '4431',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true,
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as FiscalParameterEntity;
}

function declaration(): FiscalDeclarationEntity {
  return {
    id: 'd1',
    organizationId: 'org1',
    taxCode: 'TVA',
    label: 'TVA',
    periodYear: 2026,
    periodMonth: 3,
    baseAmount: '45000000.00',
    rate: '18.0000',
    amountDue: '8100000.00',
    currency: 'XOF',
    dueDate: '2026-04-15',
    status: 'a_deposer',
    reference: null,
    justificatifUrl: null,
    chargeAccount: '4434',
    liabilityAccount: '4431',
    comment: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as FiscalDeclarationEntity;
}

function bracket(): FiscalTaxBracketEntity {
  return {
    id: 'b1',
    organizationId: 'org1',
    taxCode: 'ITS',
    effectiveFrom: '2026-01-01',
    bracketOrder: 1,
    fromAmount: '0.00',
    toAmount: '75000.00',
    rate: '0.0000',
    createdAt: NOW,
    updatedAt: NOW,
  } as FiscalTaxBracketEntity;
}

describe('fiscal-response.mapper', () => {
  it('maps parameters', () => {
    expect(toFiscalParameterResponse(param())).toMatchObject({ taxCode: 'TVA', rate: '18.0000' });
    expect(toFiscalParameterEnvelope(param()).parameter.taxCode).toBe('TVA');
    expect(toListFiscalParameters([param()]).parameters).toHaveLength(1);
  });

  it('maps declarations', () => {
    expect(toFiscalDeclarationResponse(declaration())).toMatchObject({
      amountDue: '8100000.00',
      dueDate: '2026-04-15',
    });
    expect(toFiscalDeclarationEnvelope(declaration()).declaration.taxCode).toBe('TVA');
    expect(toListFiscalDeclarations([declaration()], 1).total).toBe(1);
  });

  it('maps brackets', () => {
    expect(toFiscalBracketResponse(bracket())).toMatchObject({ bracketOrder: 1, rate: '0.0000' });
    expect(toListFiscalBrackets([bracket()]).brackets).toHaveLength(1);
  });
});
