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

describe('Note 7 — Clients et comptes rattachés', () => {
  it('agrège les soldes 411/412/416/418/419 dans les bonnes catégories', async () => {
    const { service, reportsMock, request } = buildHarness();
    reportsMock.accountBalancesAsAt.mockResolvedValue([
      bal({ accountCode: '411000', totalDebit: '15000.00', totalCredit: '0.00' }),
      bal({ accountCode: '411100', totalDebit: '5000.00', totalCredit: '2000.00' }),
      bal({ accountCode: '416000', totalDebit: '1500.00', totalCredit: '0.00' }),
      bal({ accountCode: '418000', totalDebit: '4000.00', totalCredit: '0.00' }),
      bal({ accountCode: '419000', totalDebit: '0.00', totalCredit: '800.00' }),
      // Compte non-client → ignoré
      bal({ accountCode: '401000', totalDebit: '0.00', totalCredit: '99999.00' }),
    ]);

    const n7 = await service.getNote(request, 'N7' as NoteId);
    expect(n7.applicable).toBe(true);

    const byKey = new Map(n7.rows.map((r) => [r.key, r]));
    // 411 : 15000 + (5000-2000) = 18000 net débit
    expect(byKey.get('CLIENTS_PRINCIPAL')?.values.debit).toBe('18000.00');
    expect(byKey.get('CLIENTS_PRINCIPAL')?.values.credit).toBe('0.00');
    expect(byKey.get('CLIENTS_DOUTEUX')?.values.debit).toBe('1500.00');
    expect(byKey.get('CLIENTS_PNF')?.values.debit).toBe('4000.00');
    // 419 créditeur (avances)
    expect(byKey.get('CLIENTS_CREDITEURS')?.values.credit).toBe('800.00');
    expect(byKey.get('CLIENTS_CREDITEURS')?.values.debit).toBe('0.00');

    // TOTAL débit = 18000 + 1500 + 4000 = 23500 ; crédit = 800
    expect(byKey.get('TOTAL')?.values.debit).toBe('23500.00');
    expect(byKey.get('TOTAL')?.values.credit).toBe('800.00');
  });

  it('applicable=false si aucun compte client', async () => {
    const { service, request } = buildHarness();
    const n7 = await service.getNote(request, 'N7' as NoteId);
    expect(n7.applicable).toBe(false);
  });
});
