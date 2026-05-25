import type { NoteId } from '../../services/notes-annexes';
import { buildHarness } from './test-helpers';

interface Bal {
  accountId: string;
  accountCode: string;
  accountLabel: string;
  accountClass: number;
  isOpposing: boolean;
  totalDebit: string;
  totalCredit: string;
}

function bal(o: Partial<Bal> & { accountCode: string }): Bal {
  return {
    accountId: 'acc-' + o.accountCode,
    accountLabel: 'Compte ' + o.accountCode,
    accountClass: Number(o.accountCode.charAt(0)),
    isOpposing: false,
    totalDebit: '0.00',
    totalCredit: '0.00',
    ...o,
  };
}

describe('Note 28 — Provisions financières', () => {
  it('ventile par type de provision (191/192/194/195/197/198)', async () => {
    const { service, reportsMock, request } = buildHarness();
    reportsMock.accountBalancesAsAt.mockResolvedValue([
      bal({ accountCode: '191000', totalDebit: '0.00', totalCredit: '50000.00' }),
      bal({ accountCode: '192000', totalDebit: '0.00', totalCredit: '12000.00' }),
      bal({ accountCode: '194000', totalDebit: '0.00', totalCredit: '8000.00' }),
      // pas de 195 → 0
      bal({ accountCode: '198000', totalDebit: '0.00', totalCredit: '5000.00' }),
      // bruit
      bal({ accountCode: '411000', totalDebit: '100.00', totalCredit: '0.00' }),
    ]);

    const n28 = await service.getNote(request, 'N28' as NoteId);
    expect(n28.applicable).toBe(true);

    const byKey = new Map(n28.rows.map((r) => [r.key, r]));
    expect(byKey.get('LITIGES')?.values.provision).toBe('50000.00');
    expect(byKey.get('GARANTIES')?.values.provision).toBe('12000.00');
    expect(byKey.get('PERTES_TERME')?.values.provision).toBe('8000.00');
    expect(byKey.get('IMPOTS')?.values.provision).toBe('0.00');
    expect(byKey.get('AUTRES')?.values.provision).toBe('5000.00');
    expect(byKey.get('TOTAL')?.values.provision).toBe('75000.00');
  });

  it('applicable=false si aucun 19x', async () => {
    const { service, reportsMock, request } = buildHarness();
    reportsMock.accountBalancesAsAt.mockResolvedValue([
      bal({ accountCode: '411000', totalDebit: '100.00', totalCredit: '0.00' }),
    ]);
    const n28 = await service.getNote(request, 'N28' as NoteId);
    expect(n28.applicable).toBe(false);
  });
});
