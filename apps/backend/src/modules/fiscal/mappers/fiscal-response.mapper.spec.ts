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

const FIXED_DATE = new Date('2026-05-25T10:00:00.000Z');

function buildParameter(overrides: Partial<FiscalParameterEntity> = {}): FiscalParameterEntity {
  return {
    id: 'param-1',
    organizationId: 'org-1',
    organization: undefined as never,
    taxCode: 'TVA',
    label: 'TVA 18%',
    declarationKind: 'fiscal',
    rate: '18.00',
    baseKind: 'vat_net',
    periodicity: 'monthly',
    ceiling: null,
    floorAmount: null,
    dueDay: 15,
    chargeAccount: null,
    liabilityAccount: '4441',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true,
    notes: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as FiscalParameterEntity;
}

function buildDeclaration(
  overrides: Partial<FiscalDeclarationEntity> = {},
): FiscalDeclarationEntity {
  return {
    id: 'decl-1',
    organizationId: 'org-1',
    organization: undefined as never,
    taxCode: 'TVA',
    label: 'TVA mai 2026',
    periodYear: 2026,
    periodMonth: 5,
    baseAmount: '10000000.00',
    rate: '18.00',
    amountDue: '1800000.00',
    currency: 'XOF',
    dueDate: '2026-06-15',
    status: 'a_deposer',
    reference: null,
    justificatifUrl: null,
    chargeAccount: null,
    liabilityAccount: '4441',
    comment: null,
    createdById: 'user-1',
    validatedById: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as FiscalDeclarationEntity;
}

function buildBracket(overrides: Partial<FiscalTaxBracketEntity> = {}): FiscalTaxBracketEntity {
  return {
    id: 'bracket-1',
    organizationId: 'org-1',
    organization: undefined as never,
    taxCode: 'ITS',
    effectiveFrom: '2026-01-01',
    bracketOrder: 1,
    fromAmount: '0.00',
    toAmount: '75000.00',
    rate: '0.00',
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as FiscalTaxBracketEntity;
}

describe('fiscal-response.mapper', () => {
  describe('toFiscalParameterResponse', () => {
    it('maps every parameter field with rate kept as string', () => {
      const dto = toFiscalParameterResponse(buildParameter());

      expect(dto).toEqual({
        id: 'param-1',
        organizationId: 'org-1',
        taxCode: 'TVA',
        label: 'TVA 18%',
        declarationKind: 'fiscal',
        rate: '18.00',
        baseKind: 'vat_net',
        periodicity: 'monthly',
        ceiling: null,
        floorAmount: null,
        dueDay: 15,
        chargeAccount: null,
        liabilityAccount: '4441',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
        notes: null,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      });
    });

    it('does not leak the organization relation', () => {
      expect(toFiscalParameterResponse(buildParameter())).not.toHaveProperty('organization');
    });
  });

  describe('toFiscalDeclarationResponse', () => {
    it('maps a declaration and drops internal audit columns', () => {
      const dto = toFiscalDeclarationResponse(buildDeclaration());

      expect(dto.id).toBe('decl-1');
      expect(dto.baseAmount).toBe('10000000.00');
      expect(dto.amountDue).toBe('1800000.00');
      expect(dto.status).toBe('a_deposer');
      expect(dto.dueDate).toBe('2026-06-15');
      expect(dto).not.toHaveProperty('createdById');
      expect(dto).not.toHaveProperty('validatedById');
    });

    it('preserves nullable annual fields (no period month)', () => {
      const dto = toFiscalDeclarationResponse(buildDeclaration({ periodMonth: null, label: null }));
      expect(dto.periodMonth).toBeNull();
      expect(dto.label).toBeNull();
    });
  });

  describe('toFiscalBracketResponse', () => {
    it('maps a progressive-tax bracket with nullable upper bound', () => {
      const dto = toFiscalBracketResponse(buildBracket({ toAmount: null }));

      expect(dto).toEqual({
        id: 'bracket-1',
        organizationId: 'org-1',
        taxCode: 'ITS',
        effectiveFrom: '2026-01-01',
        bracketOrder: 1,
        fromAmount: '0.00',
        toAmount: null,
        rate: '0.00',
      });
    });
  });

  describe('envelope + list wrappers', () => {
    it('wraps a single parameter and a list', () => {
      expect(toFiscalParameterEnvelope(buildParameter()).parameter.id).toBe('param-1');
      const list = toListFiscalParameters([
        buildParameter(),
        buildParameter({ id: 'param-2', taxCode: 'IS' }),
      ]);
      expect(list.parameters).toHaveLength(2);
      expect(list.parameters[1]?.taxCode).toBe('IS');
    });

    it('wraps a single declaration and a list with total', () => {
      expect(toFiscalDeclarationEnvelope(buildDeclaration()).declaration.id).toBe('decl-1');
      const list = toListFiscalDeclarations([buildDeclaration()], 7);
      expect(list.declarations).toHaveLength(1);
      expect(list.total).toBe(7);
    });

    it('wraps a list of brackets', () => {
      const list = toListFiscalBrackets([
        buildBracket(),
        buildBracket({ id: 'bracket-2', bracketOrder: 2 }),
      ]);
      expect(list.brackets).toHaveLength(2);
      expect(list.brackets[1]?.bracketOrder).toBe(2);
    });
  });
});
