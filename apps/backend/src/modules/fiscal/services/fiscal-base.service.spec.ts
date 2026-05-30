import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { FiscalBaseRepository, PrefixSum } from '../repositories/fiscal-base.repository';
import { FiscalBaseService } from './fiscal-base.service';

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');

/** Repo mock qui renvoie une somme selon le préfixe demandé. */
function makeService(byPrefix: Record<string, PrefixSum>): {
  service: FiscalBaseService;
  sum: jest.Mock;
} {
  const sum = jest.fn((_org, _from, _to, prefixes: readonly string[]) =>
    Promise.resolve(byPrefix[prefixes.join(',')] ?? { totalDebit: '0', totalCredit: '0' }),
  );
  const repo = { sumByPrefixes: sum } as unknown as FiscalBaseRepository;
  return { service: new FiscalBaseService(repo), sum };
}

describe('FiscalBaseService.computeBase', () => {
  it('turnover = crédit − débit de la classe 7', async () => {
    const { service } = makeService({ '7': { totalDebit: '0.00', totalCredit: '45000000.00' } });
    const base = await service.computeBase(ORG, 'turnover', 2026, 3);
    expect(base).toBe('45000000.00');
  });

  it('salary_gross = débit − crédit de la classe 66', async () => {
    const { service } = makeService({ '66': { totalDebit: '18000000.00', totalCredit: '0.00' } });
    const base = await service.computeBase(ORG, 'salary_gross', 2026, 3);
    expect(base).toBe('18000000.00');
  });

  it('vat_net = TVA collectée (443) − déductible (445)', async () => {
    const { service } = makeService({
      '443': { totalDebit: '0.00', totalCredit: '8100000.00' },
      '445': { totalDebit: '3000000.00', totalCredit: '0.00' },
    });
    const base = await service.computeBase(ORG, 'vat_net', 2026, 3);
    expect(base).toBe('5100000.00');
  });

  it('accounting_result = produits (7) − charges (6)', async () => {
    const { service } = makeService({
      '7': { totalDebit: '0.00', totalCredit: '45000000.00' },
      '6': { totalDebit: '30000000.00', totalCredit: '0.00' },
    });
    const base = await service.computeBase(ORG, 'accounting_result', 2026, null);
    expect(base).toBe('15000000.00');
  });

  it('custom → 0 (saisie manuelle)', async () => {
    const { service } = makeService({});
    const base = await service.computeBase(ORG, 'custom', 2026, 3);
    expect(base).toBe('0.00');
  });
});
