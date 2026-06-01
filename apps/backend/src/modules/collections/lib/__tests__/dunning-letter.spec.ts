import { buildDunningLetter, type DunningLetterInput } from '../dunning-letter';

function input(partial: Partial<DunningLetterInput> = {}): DunningLetterInput {
  return {
    creditorName: 'Gravel Ivoire SA',
    partnerLabel: '411DUPONT Dupont SARL',
    referenceDate: '2026-06-01',
    level: 'first',
    invoices: [
      { invoiceNumber: 'FA-2026-001', dueDate: '2026-04-30', amount: '1200000.00', overdueDays: 32 },
    ],
    totalOverdue: '1200000.00',
    ...partial,
  };
}

describe('buildDunningLetter', () => {
  it('inclut le créancier, le tiers, l\'objet et le total dû', () => {
    const letter = buildDunningLetter(input());
    expect(letter.body).toContain('Gravel Ivoire SA');
    expect(letter.body).toContain('411DUPONT Dupont SARL');
    expect(letter.body).toContain('Total dû : 1200000.00 XOF');
    expect(letter.subject).toContain('1re relance');
  });

  it('liste chaque facture échue avec son retard', () => {
    const letter = buildDunningLetter(input());
    expect(letter.body).toContain('Facture FA-2026-001 échue le 2026-04-30 : 1200000.00 XOF');
    expect(letter.body).toContain('retard : 32 j');
  });

  it('emploie un ton de mise en demeure au palier formal_notice', () => {
    const letter = buildDunningLetter(input({ level: 'formal_notice' }));
    expect(letter.subject).toContain('Mise en demeure');
    expect(letter.body).toContain('MISE EN DEMEURE');
  });

  it('respecte la devise fournie', () => {
    const letter = buildDunningLetter(input({ currency: 'EUR', totalOverdue: '5000.00' }));
    expect(letter.body).toContain('Total dû : 5000.00 EUR');
  });

  it('n\'affiche pas de mention de retard pour une facture à échoir', () => {
    const letter = buildDunningLetter(
      input({
        level: 'reminder',
        invoices: [
          { invoiceNumber: 'FA-2026-009', dueDate: '2026-06-10', amount: '300000.00', overdueDays: -9 },
        ],
      }),
    );
    expect(letter.body).not.toContain('retard :');
  });
});
