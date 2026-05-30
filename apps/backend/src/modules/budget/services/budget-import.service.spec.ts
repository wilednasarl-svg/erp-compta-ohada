import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { BudgetAxisEntity } from '../entities/budget-axis.entity';
import type { BudgetAxisRepository } from '../repositories/budget-axis.repository';
import type { RawRecord } from '../lib/budget-template';
import { BudgetImportService } from './budget-import.service';
import type { BudgetLinesService } from './budget-lines.service';

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');

function axis(axisType: string, code: string, id: string): BudgetAxisEntity {
  return { id, axisType, code } as BudgetAxisEntity;
}

function makeService(opts: { axes: BudgetAxisEntity[]; upsert?: jest.Mock }): {
  service: BudgetImportService;
  upsert: jest.Mock;
} {
  const upsert =
    opts.upsert ?? jest.fn().mockResolvedValue({ line: { id: 'x' }, action: 'created' });
  const linesService = { upsert } as unknown as BudgetLinesService;
  const axesRepo = {
    list: jest.fn().mockResolvedValue(opts.axes),
  } as unknown as BudgetAxisRepository;
  return { service: new BudgetImportService(linesService, axesRepo), upsert };
}

describe('BudgetImportService.importRecords', () => {
  const validRecord: RawRecord = {
    exercice: '2026',
    periode: '2026-03',
    type_budget: 'OPEX',
    code_compte: '6221',
    code_cc: 'COMM',
    montant_budgete: '1500000',
  };

  it('resolves axis codes to ids and upserts valid rows', async () => {
    const { service, upsert } = makeService({
      axes: [axis('cost_center', 'COMM', 'cc-uuid')],
    });

    const report = await service.importRecords(ORG, [validRecord], 'user-1');

    expect(report.totalRows).toBe(1);
    expect(report.created).toBe(1);
    expect(report.skipped).toBe(0);
    expect(upsert).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ accountCode: '6221', costCenterAxisId: 'cc-uuid' }),
    );
  });

  it('reports an error when an axis code is unknown', async () => {
    const { service, upsert } = makeService({ axes: [] });

    const report = await service.importRecords(ORG, [validRecord], null);

    expect(report.created).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.errors[0].messages[0]).toContain('cost_center');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports validation errors without calling upsert', async () => {
    const { service, upsert } = makeService({ axes: [] });
    const badRecord: RawRecord = {
      exercice: '99',
      type_budget: 'XXX',
      code_compte: 'ABC',
      montant_budgete: 'oops',
    };

    const report = await service.importRecords(ORG, [badRecord], null);

    expect(report.skipped).toBe(1);
    expect(report.errors[0].row).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('counts created vs updated', async () => {
    const upsert = jest
      .fn()
      .mockResolvedValueOnce({ line: { id: 'a' }, action: 'created' })
      .mockResolvedValueOnce({ line: { id: 'b' }, action: 'updated' });
    const { service } = makeService({
      axes: [axis('cost_center', 'COMM', 'cc-uuid')],
      upsert,
    });

    const report = await service.importRecords(ORG, [validRecord, validRecord], null);

    expect(report.created).toBe(1);
    expect(report.updated).toBe(1);
  });
});
