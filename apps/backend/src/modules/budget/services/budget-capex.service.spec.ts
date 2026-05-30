import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { BudgetLineEntity } from '../entities/budget-line.entity';
import type { BudgetLinesService } from './budget-lines.service';
import { BudgetCapexService } from './budget-capex.service';

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');

function capexLine(): BudgetLineEntity {
  return {
    id: 'capex-1',
    fiscalYear: 2026,
    budgetType: 'CAPEX',
    scenario: 'BI',
    accountCode: '2441',
    amount: '12000000.00',
  } as BudgetLineEntity;
}

function makeService(opts: { line?: BudgetLineEntity } = {}): {
  service: BudgetCapexService;
  upsert: jest.Mock;
} {
  const upsert = jest.fn((_o, cmd) =>
    Promise.resolve({ line: { id: 'd', ...cmd }, action: 'created' }),
  );
  const lines = {
    findById: jest.fn().mockResolvedValue(opts.line ?? capexLine()),
    upsert,
  } as unknown as BudgetLinesService;
  return { service: new BudgetCapexService(lines), upsert };
}

describe('BudgetCapexService.generateAmortization', () => {
  it('génère 12 dotations OPEX 6811 pour un exercice plein', async () => {
    const { service, upsert } = makeService();
    const { created } = await service.generateAmortization(ORG, {
      capexLineId: 'capex-1',
      serviceDate: '2026-01-01',
      durationYears: 3,
    });
    expect(created).toHaveLength(12);
    expect(upsert).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        budgetType: 'OPEX',
        accountCode: '6811',
        periodMonth: 1,
        amount: '333333.33',
      }),
    );
  });

  it('prorata : mise en service avril → 9 dotations', async () => {
    const { service, upsert } = makeService();
    const { created } = await service.generateAmortization(ORG, {
      capexLineId: 'capex-1',
      serviceDate: '2026-04-01',
      durationYears: 3,
    });
    expect(created).toHaveLength(9);
    expect(upsert.mock.calls[0][1].periodMonth).toBe(4);
  });

  it('refuse une ligne non-CAPEX', async () => {
    const opex = { ...capexLine(), budgetType: 'OPEX' } as BudgetLineEntity;
    const { service } = makeService({ line: opex });
    await expect(
      service.generateAmortization(ORG, {
        capexLineId: 'x',
        serviceDate: '2026-01-01',
        durationYears: 3,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.BUDGET_LINE_NOT_CAPEX });
  });

  it('rejette via AppException (type)', async () => {
    const opex = { ...capexLine(), budgetType: 'RH' } as BudgetLineEntity;
    const { service } = makeService({ line: opex });
    await expect(
      service.generateAmortization(ORG, {
        capexLineId: 'x',
        serviceDate: '2026-01-01',
        durationYears: 2,
      }),
    ).rejects.toBeInstanceOf(AppException);
  });
});
