import type { NoteId } from '../../services/notes-annexes';
import { buildHarness } from './test-helpers';

describe('Note 23 — Achats consommés', () => {
  it('ventile 601/604/605/608 en lignes distinctes sans double comptage', async () => {
    const { service, reportsMock, request } = buildHarness();
    // Note de gestion (classe 6) → alimentée par accountMovementsBetween.
    reportsMock.accountMovementsBetween.mockResolvedValue([
      { accountCode: '601000', totalDebit: '10000.00', totalCredit: '0.00' },
      { accountCode: '604000', totalDebit: '2000.00', totalCredit: '0.00' },
      { accountCode: '605100', totalDebit: '3000.00', totalCredit: '0.00' }, // eau (sous-compte de 605)
      { accountCode: '608000', totalDebit: '1000.00', totalCredit: '0.00' }, // emballages
    ]);

    const n23 = await service.getNote(request, 'N23' as NoteId);
    const byKey = new Map(n23.rows.map((r) => [r.key, r]));

    expect(byKey.get('ACHATS_MARCHANDISES')?.values.debit).toBe('10000.00');
    // 604 seul dans « Autres approvisionnements ».
    expect(byKey.get('AUTRES_APPROS')?.values.debit).toBe('2000.00');
    // 605x désormais capté ici (n'est plus une ligne morte interceptée par 604/605/608).
    expect(byKey.get('EAU_ENERGIE')?.values.debit).toBe('3000.00');
    // 608 désormais capté ici (n'est plus une ligne morte).
    expect(byKey.get('EMBALLAGES')?.values.debit).toBe('1000.00');
    // Total = 10000 + 2000 + 3000 + 1000 = 16000 (chaque compte compté UNE fois).
    expect(byKey.get('TOTAL')?.values.debit).toBe('16000.00');
  });
});
