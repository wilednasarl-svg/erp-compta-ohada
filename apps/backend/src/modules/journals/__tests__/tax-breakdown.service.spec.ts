import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';
import { TaxBreakdownService } from '../services/tax-breakdown.service';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');

function buildService(
  rows: Array<{ taxCode: string; totalDebit: string; totalCredit: string; lineCount: number }>,
) {
  const aggregateByTaxCode = jest.fn().mockResolvedValue(rows);
  const lineRepo = { aggregateByTaxCode } as unknown as JournalEntryLineRepository;
  return { service: new TaxBreakdownService(lineRepo), aggregateByTaxCode };
}

describe('TaxBreakdownService.getBreakdown', () => {
  it('formats per-code rows with net and accumulates grand totals', async () => {
    const { service } = buildService([
      { taxCode: '18', totalDebit: '0', totalCredit: '1800', lineCount: 5 },
      { taxCode: '09', totalDebit: '0', totalCredit: '450.5', lineCount: 2 },
      { taxCode: 'DED', totalDebit: '1200', totalCredit: '0', lineCount: 3 },
    ]);

    const report = await service.getBreakdown(ORG_ID, { from: '2026-01-01', to: '2026-12-31' });

    expect(report.from).toBe('2026-01-01');
    expect(report.to).toBe('2026-12-31');
    expect(report.codes).toEqual([
      { taxCode: '18', totalDebit: '0.00', totalCredit: '1800.00', net: '-1800.00', lineCount: 5 },
      { taxCode: '09', totalDebit: '0.00', totalCredit: '450.50', net: '-450.50', lineCount: 2 },
      { taxCode: 'DED', totalDebit: '1200.00', totalCredit: '0.00', net: '1200.00', lineCount: 3 },
    ]);
    expect(report.totals).toEqual({
      totalDebit: '1200.00',
      totalCredit: '2250.50',
      net: '-1050.50',
      lineCount: 10,
    });
  });

  it('defaults the range to the current calendar year when not provided', async () => {
    const { service, aggregateByTaxCode } = buildService([]);
    const report = await service.getBreakdown(ORG_ID, {});

    const year = new Date().toISOString().slice(0, 4);
    expect(report.from).toBe(`${year}-01-01`);
    expect(aggregateByTaxCode).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ from: `${year}-01-01` }),
    );
  });

  it('returns zeroed totals and no codes when no tax-coded lines exist', async () => {
    const { service } = buildService([]);
    const report = await service.getBreakdown(ORG_ID, { from: '2026-01-01', to: '2026-03-31' });
    expect(report.codes).toEqual([]);
    expect(report.totals).toEqual({
      totalDebit: '0.00',
      totalCredit: '0.00',
      net: '0.00',
      lineCount: 0,
    });
  });

  it('ignores a malformed date input and falls back to a sane range', async () => {
    const { service } = buildService([]);
    const report = await service.getBreakdown(ORG_ID, { from: 'not-a-date', to: '2026-06-30' });
    const year = new Date().toISOString().slice(0, 4);
    expect(report.from).toBe(`${year}-01-01`);
    expect(report.to).toBe('2026-06-30');
  });
});
