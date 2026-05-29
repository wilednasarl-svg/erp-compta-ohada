import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import type { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';
import { AgingService } from '../services/aging.service';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const CLIENT_ID = '00000000-0000-4000-8000-0000000000c1';
const SUPPLIER_ID = '00000000-0000-4000-8000-0000000000f1';

function line(
  accountId: string,
  code: string,
  debit: string,
  credit: string,
  dueDate: string | null,
): JournalEntryLineEntity {
  return {
    accountId,
    account: { id: accountId, code, label: code === '411000' ? 'CLIENT X' : 'FRN Y', class: 4 },
    debit,
    credit,
    dueDate,
  } as unknown as JournalEntryLineEntity;
}

function buildService(lines: JournalEntryLineEntity[]) {
  const listOpenPartnerLines = jest.fn().mockResolvedValue(lines);
  const lineRepo = { listOpenPartnerLines } as unknown as JournalEntryLineRepository;
  return { service: new AgingService(lineRepo), listOpenPartnerLines };
}

describe('AgingService.getAging', () => {
  // Date de référence fixe pour des tranches déterministes.
  const REF = '2026-03-01';

  it('buckets open client lines by due-date age relative to the reference date', async () => {
    const { service } = buildService([
      line(CLIENT_ID, '411000', '1000', '0', '2026-04-01'), // futur → notDue
      line(CLIENT_ID, '411000', '500', '0', '2026-02-15'), // 14 j → d1_30
      line(CLIENT_ID, '411000', '300', '0', '2026-01-01'), // 59 j → d31_60
      line(CLIENT_ID, '411000', '250', '0', '2025-12-20'), // 71 j → d61_90
      line(CLIENT_ID, '411000', '200', '0', '2025-11-01'), // 120 j → d90plus
      line(CLIENT_ID, '411000', '0', '100', null), // règlement sans échéance
    ]);

    const report = await service.getAging(ORG_ID, { referenceDate: REF, side: 'client' });

    expect(report.referenceDate).toBe(REF);
    expect(report.partners).toHaveLength(1);
    const p = report.partners[0];
    expect(p.side).toBe('client');
    expect(p.partnerAccountCode).toBe('411000');
    expect(p.buckets).toEqual({
      notDue: '1000.00',
      d1_30: '500.00',
      d31_60: '300.00',
      d61_90: '250.00',
      d90plus: '200.00',
      noDueDate: '-100.00',
      total: '2150.00',
    });
    expect(report.totals.total).toBe('2150.00');
  });

  it('treats a due date equal to the reference date as not due', async () => {
    const { service } = buildService([
      line(CLIENT_ID, '411000', '400', '0', REF),
      line(CLIENT_ID, '411000', '0', '400', REF),
    ]);
    const report = await service.getAging(ORG_ID, { referenceDate: REF });
    expect(report.totals.notDue).toBe('0.00');
    expect(report.totals.total).toBe('0.00');
  });

  it('derives side per partner from the account sub-class (40 vs 41)', async () => {
    const { service } = buildService([
      line(CLIENT_ID, '411000', '600', '0', '2026-02-01'),
      line(SUPPLIER_ID, '401000', '0', '900', '2026-02-01'),
    ]);
    const report = await service.getAging(ORG_ID, { referenceDate: REF, side: 'all' });
    const byCode = Object.fromEntries(report.partners.map((p) => [p.partnerAccountCode, p]));
    expect(byCode['411000'].side).toBe('client');
    expect(byCode['401000'].side).toBe('fournisseur');
    expect(byCode['401000'].buckets.d1_30).toBe('-900.00');
  });

  it('passes the side filter down to the repository sub-class selection', async () => {
    const { service, listOpenPartnerLines } = buildService([]);
    await service.getAging(ORG_ID, { referenceDate: REF, side: 'fournisseur' });
    expect(listOpenPartnerLines).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ subClasses: ['40'] }),
    );
  });

  it('returns empty partners and zeroed totals when there are no open lines', async () => {
    const { service } = buildService([]);
    const report = await service.getAging(ORG_ID, { referenceDate: REF });
    expect(report.partners).toEqual([]);
    expect(report.totals).toEqual({
      notDue: '0.00',
      d1_30: '0.00',
      d31_60: '0.00',
      d61_90: '0.00',
      d90plus: '0.00',
      noDueDate: '0.00',
      total: '0.00',
    });
  });
});
