import type { BudgetAxisEntity } from '../entities/budget-axis.entity';
import type { BudgetLineEntity } from '../entities/budget-line.entity';
import {
  toBudgetAxisEnvelope,
  toBudgetAxisResponse,
  toBudgetLineEnvelope,
  toBudgetLineResponse,
  toListBudgetAxes,
  toListBudgetLines,
} from './budget-response.mapper';

const FIXED_DATE = new Date('2026-05-25T10:00:00.000Z');

function buildAxis(overrides: Partial<BudgetAxisEntity> = {}): BudgetAxisEntity {
  return {
    id: 'axis-1',
    organizationId: 'org-1',
    organization: undefined as never,
    axisType: 'cost_center',
    code: 'CC-001',
    label: 'Centre de coût 1',
    parentId: null,
    parent: null,
    isActive: true,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as BudgetAxisEntity;
}

function buildLine(overrides: Partial<BudgetLineEntity> = {}): BudgetLineEntity {
  return {
    id: 'line-1',
    organizationId: 'org-1',
    organization: undefined as never,
    fiscalYear: 2026,
    periodMonth: 5,
    budgetType: 'OPEX',
    scenario: 'BI',
    accountCode: '604000',
    accountLabel: 'Achats stockés',
    costCenterAxisId: 'axis-1',
    projectAxisId: null,
    agencyAxisId: null,
    productAxisId: null,
    amount: '1500000.00',
    currency: 'XOF',
    exchangeRate: '1.000000',
    amountBase: '1500000.00',
    comment: null,
    hypothesis: null,
    status: 'valide_daf',
    createdById: 'user-1',
    validatedById: 'user-2',
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as BudgetLineEntity;
}

describe('budget-response.mapper', () => {
  describe('toBudgetAxisResponse', () => {
    it('maps every axis field including nullable parentId', () => {
      const dto = toBudgetAxisResponse(buildAxis({ parentId: 'axis-0' }));

      expect(dto).toEqual({
        id: 'axis-1',
        organizationId: 'org-1',
        axisType: 'cost_center',
        code: 'CC-001',
        label: 'Centre de coût 1',
        parentId: 'axis-0',
        isActive: true,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      });
    });

    it('does not leak the relation field', () => {
      const dto = toBudgetAxisResponse(buildAxis());
      expect(dto).not.toHaveProperty('organization');
      expect(dto).not.toHaveProperty('parent');
    });

    it('does not mutate the source entity', () => {
      const axis = buildAxis();
      const snapshot = JSON.parse(JSON.stringify(axis));
      toBudgetAxisResponse(axis);
      expect(JSON.parse(JSON.stringify(axis))).toEqual(snapshot);
    });
  });

  describe('toBudgetLineResponse', () => {
    it('keeps decimal amounts as strings and maps nullable axes', () => {
      const dto = toBudgetLineResponse(buildLine());

      expect(dto.amount).toBe('1500000.00');
      expect(dto.exchangeRate).toBe('1.000000');
      expect(dto.amountBase).toBe('1500000.00');
      expect(dto.costCenterAxisId).toBe('axis-1');
      expect(dto.projectAxisId).toBeNull();
      expect(dto.status).toBe('valide_daf');
    });

    it('does not expose internal audit columns', () => {
      const dto = toBudgetLineResponse(buildLine());
      expect(dto).not.toHaveProperty('createdById');
      expect(dto).not.toHaveProperty('validatedById');
      expect(dto).not.toHaveProperty('organization');
    });
  });

  describe('envelope + list wrappers', () => {
    it('wraps a single axis', () => {
      expect(toBudgetAxisEnvelope(buildAxis()).axis.id).toBe('axis-1');
    });

    it('wraps a list of axes', () => {
      const list = toListBudgetAxes([buildAxis(), buildAxis({ id: 'axis-2', code: 'CC-002' })]);
      expect(list.axes).toHaveLength(2);
      expect(list.axes[1]?.code).toBe('CC-002');
    });

    it('wraps a single line', () => {
      expect(toBudgetLineEnvelope(buildLine()).line.id).toBe('line-1');
    });

    it('wraps a list of lines and carries the total', () => {
      const list = toListBudgetLines([buildLine(), buildLine({ id: 'line-2' })], 42);
      expect(list.lines).toHaveLength(2);
      expect(list.total).toBe(42);
      expect(list.lines[1]?.id).toBe('line-2');
    });
  });
});
