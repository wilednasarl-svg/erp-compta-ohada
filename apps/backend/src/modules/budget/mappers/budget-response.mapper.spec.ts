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

const NOW = new Date('2026-01-01T00:00:00.000Z');

function axis(): BudgetAxisEntity {
  return {
    id: 'a1',
    organizationId: 'org1',
    axisType: 'cost_center',
    code: 'COMM',
    label: 'Commercial',
    parentId: null,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  } as BudgetAxisEntity;
}

function line(): BudgetLineEntity {
  return {
    id: 'l1',
    organizationId: 'org1',
    fiscalYear: 2026,
    periodMonth: 3,
    budgetType: 'OPEX',
    scenario: 'BI',
    accountCode: '6221',
    accountLabel: 'Locations',
    costCenterAxisId: 'a1',
    projectAxisId: null,
    agencyAxisId: null,
    productAxisId: null,
    amount: '1500000.00',
    currency: 'XOF',
    exchangeRate: '1.000000',
    amountBase: '1500000.00',
    comment: null,
    hypothesis: null,
    status: 'brouillon',
    createdAt: NOW,
    updatedAt: NOW,
  } as BudgetLineEntity;
}

describe('budget-response.mapper', () => {
  it('maps an axis and wraps it', () => {
    const r = toBudgetAxisResponse(axis());
    expect(r).toMatchObject({ id: 'a1', axisType: 'cost_center', code: 'COMM' });
    expect(toBudgetAxisEnvelope(axis()).axis.code).toBe('COMM');
    expect(toListBudgetAxes([axis(), axis()]).axes).toHaveLength(2);
  });

  it('maps a line and wraps it with total', () => {
    const r = toBudgetLineResponse(line());
    expect(r).toMatchObject({ accountCode: '6221', amountBase: '1500000.00', status: 'brouillon' });
    expect(toBudgetLineEnvelope(line()).line.accountCode).toBe('6221');
    const list = toListBudgetLines([line()], 1);
    expect(list.total).toBe(1);
    expect(list.lines).toHaveLength(1);
  });
});
