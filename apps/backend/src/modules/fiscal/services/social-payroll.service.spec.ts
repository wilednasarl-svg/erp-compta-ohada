import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { FiscalParameterEntity } from '../entities/fiscal-parameter.entity';
import type { SocialPayrollLineEntity } from '../entities/social-payroll-line.entity';
import type { FiscalParameterRepository } from '../repositories/fiscal-parameter.repository';
import type { FiscalTaxBracketRepository } from '../repositories/fiscal-tax-bracket.repository';
import type { SocialPayrollRepository } from '../repositories/social-payroll.repository';
import type { FiscalDeclarationsService } from './fiscal-declarations.service';
import { SocialPayrollService } from './social-payroll.service';

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');

function param(taxCode: string, rate: string, ceiling: string | null): FiscalParameterEntity {
  return {
    taxCode,
    label: taxCode,
    rate,
    ceiling,
    declarationKind: 'social',
  } as FiscalParameterEntity;
}

function line(employeeRef: string, gross: string): SocialPayrollLineEntity {
  return { id: employeeRef, employeeRef, grossSalary: gross } as SocialPayrollLineEntity;
}

const ITS_BRACKETS = [
  { fromAmount: '0.00', toAmount: '75000.00', rate: '0.0000' },
  { fromAmount: '75000.00', toAmount: null, rate: '16.0000' },
];

function makeService(opts: { generate?: jest.Mock } = {}): {
  service: SocialPayrollService;
  generate: jest.Mock;
} {
  const payroll = {
    listForPeriod: jest.fn().mockResolvedValue([line('A', '100000.00'), line('B', '300000.00')]),
  } as unknown as SocialPayrollRepository;
  const params = {
    list: jest
      .fn()
      .mockResolvedValue([param('CNPS_PF', '5.7500', '70000.00'), param('ITS', '0.0000', null)]),
    findEffective: jest.fn((_o, code: string) =>
      Promise.resolve(
        code === 'CNPS_PF' ? param('CNPS_PF', '5.7500', '70000.00') : param('ITS', '0.0000', null),
      ),
    ),
  } as unknown as FiscalParameterRepository;
  const brackets = {
    findEffective: jest.fn((_o, code: string) =>
      Promise.resolve(code === 'ITS' ? ITS_BRACKETS : []),
    ),
  } as unknown as FiscalTaxBracketRepository;
  const generate = opts.generate ?? jest.fn((_o, cmd) => Promise.resolve({ id: 'd', ...cmd }));
  const declarations = { generate } as unknown as FiscalDeclarationsService;
  return {
    service: new SocialPayrollService(payroll, params, brackets, declarations),
    generate,
  };
}

describe('SocialPayrollService.computeSummary', () => {
  it('computes flat (capped per head) and progressive (per head) contributions', async () => {
    const { service } = makeService();
    const summary = await service.computeSummary(ORG, 2026, 3);

    expect(summary.employeeCount).toBe(2);
    expect(summary.grossTotal).toBe('400000.00');

    const cnps = summary.contributions.find((c) => c.taxCode === 'CNPS_PF');
    // capped 70000+70000 = 140000 × 5.75% = 8050
    expect(cnps).toMatchObject({ mode: 'flat', base: '140000.00', amountDue: '8050.00' });

    const its = summary.contributions.find((c) => c.taxCode === 'ITS');
    // per-head: 16%×25000 + 16%×225000 = 4000 + 36000 = 40000
    expect(its).toMatchObject({ mode: 'progressive', base: '400000.00', amountDue: '40000.00' });

    expect(summary.totalDue).toBe('48050.00');
  });
});

describe('SocialPayrollService.generateDeclarations', () => {
  it('passes the per-head amountDue as an override to the declaration generator', async () => {
    const { service, generate } = makeService();
    await service.generateDeclarations(ORG, 2026, 3, 'user-1');

    expect(generate).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        taxCode: 'ITS',
        amountOverride: '40000.00',
        baseAmount: '400000.00',
      }),
    );
    expect(generate).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ taxCode: 'CNPS_PF', amountOverride: '8050.00' }),
    );
  });
});
