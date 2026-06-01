import type { DataSource, EntityManager } from 'typeorm';

import { asTenantId } from '../../../../common/persistence/tenant-scope';
import { BudgetLineEntity } from '../../entities/budget-line.entity';
import type { ActualAggregateRow, BudgetActualsRepository } from '../../repositories/budget-actuals.repository';
import type { BudgetLineRepository } from '../../repositories/budget-line.repository';
import { BudgetActualsService } from '../budget-actuals.service';

const ORG = asTenantId('11111111-1111-4111-8111-111111111111');

function row(partial: Partial<ActualAggregateRow>): ActualAggregateRow {
  return {
    accountCode: '601100',
    accountLabel: 'Achats de marchandises',
    accountClass: 6,
    normalBalance: 'D',
    isOpposing: false,
    month: 1,
    totalDebit: '0.00',
    totalCredit: '0.00',
    ...partial,
  };
}

describe('BudgetActualsService', () => {
  let aggregate: jest.Mock;
  let create: jest.Mock;
  let managerDelete: jest.Mock;
  let service: BudgetActualsService;

  beforeEach(() => {
    aggregate = jest.fn();
    create = jest.fn().mockResolvedValue({} as BudgetLineEntity);
    managerDelete = jest.fn().mockResolvedValue({ affected: 0 });

    const fakeManager = { delete: managerDelete } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) => cb(fakeManager)),
    } as unknown as DataSource;

    const actualsRepo = {
      aggregateActualsByAccountMonth: aggregate,
    } as unknown as BudgetActualsRepository;
    const lineRepo = { create } as unknown as BudgetLineRepository;

    service = new BudgetActualsService(dataSource, actualsRepo, lineRepo);
  });

  it('purge le réalisé de l\'exercice avant de réinsérer (idempotence)', async () => {
    aggregate.mockResolvedValue([]);

    await service.syncActuals(ORG, 2026);

    expect(managerDelete).toHaveBeenCalledWith(BudgetLineEntity, {
      organizationId: ORG,
      fiscalYear: 2026,
      scenario: 'REAL',
    });
  });

  it('génère une ligne REAL OPEX orientée pour une charge (classe 6)', async () => {
    aggregate.mockResolvedValue([
      row({ accountCode: '601100', accountClass: 6, normalBalance: 'D', totalDebit: '1200000.00', totalCredit: '0.00', month: 3 }),
    ]);

    const result = await service.syncActuals(ORG, 2026, 'user-1');

    expect(create).toHaveBeenCalledTimes(1);
    const [input] = create.mock.calls[0];
    expect(input).toMatchObject({
      scenario: 'REAL',
      budgetType: 'OPEX',
      accountCode: '601100',
      periodMonth: 3,
      amount: '1200000.00',
      amountBase: '1200000.00',
      currency: 'XOF',
      status: 'verrouille',
      createdById: 'user-1',
    });
    expect(result).toEqual({
      fiscalYear: 2026,
      linesCreated: 1,
      accountsCount: 1,
      totalActual: '1200000.00',
    });
  });

  it('ignore les comptes de bilan hors pilotage budget (classe 4)', async () => {
    aggregate.mockResolvedValue([
      row({ accountCode: '411000', accountClass: 4, normalBalance: 'D', totalDebit: '500000.00', totalCredit: '0.00' }),
    ]);

    const result = await service.syncActuals(ORG, 2026);

    expect(create).not.toHaveBeenCalled();
    expect(result.linesCreated).toBe(0);
    expect(result.accountsCount).toBe(0);
  });

  it('ignore les soldes nets nuls (débit = crédit)', async () => {
    aggregate.mockResolvedValue([
      row({ accountClass: 6, normalBalance: 'D', totalDebit: '400000.00', totalCredit: '400000.00' }),
    ]);

    const result = await service.syncActuals(ORG, 2026);

    expect(create).not.toHaveBeenCalled();
    expect(result.totalActual).toBe('0.00');
  });

  it('totalise plusieurs lignes et compte les comptes distincts', async () => {
    aggregate.mockResolvedValue([
      row({ accountCode: '601100', accountClass: 6, normalBalance: 'D', totalDebit: '1000000.00', month: 1 }),
      row({ accountCode: '601100', accountClass: 6, normalBalance: 'D', totalDebit: '500000.00', month: 2 }),
      row({ accountCode: '701000', accountClass: 7, normalBalance: 'C', totalCredit: '2000000.00', month: 1 }),
    ]);

    const result = await service.syncActuals(ORG, 2026);

    expect(create).toHaveBeenCalledTimes(3);
    expect(result.linesCreated).toBe(3);
    expect(result.accountsCount).toBe(2);
    expect(result.totalActual).toBe('3500000.00');
  });
});
