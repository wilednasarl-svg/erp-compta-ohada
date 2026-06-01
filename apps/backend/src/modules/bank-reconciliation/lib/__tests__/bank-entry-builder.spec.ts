import { buildBankEntryLines } from '../bank-entry-builder';

describe('buildBankEntryLines', () => {
  it('oriente une sortie (agios/frais) en D contrepartie / C banque', () => {
    const draft = buildBankEntryLines({
      statementAmount: '-15000.00',
      bankAccountCode: '521100',
      counterpartAccountCode: '631500',
    });
    expect(draft.direction).toBe('outflow');
    expect(draft.absAmount).toBe(15000);
    expect(draft.lines).toEqual([
      { accountCode: '631500', debit: 15000, credit: 0 },
      { accountCode: '521100', debit: 0, credit: 15000 },
    ]);
  });

  it('oriente une entrée (intérêts reçus) en D banque / C produit', () => {
    const draft = buildBankEntryLines({
      statementAmount: '42000.00',
      bankAccountCode: '521100',
      counterpartAccountCode: '771000',
    });
    expect(draft.direction).toBe('inflow');
    expect(draft.lines).toEqual([
      { accountCode: '521100', debit: 42000, credit: 0 },
      { accountCode: '771000', debit: 0, credit: 42000 },
    ]);
  });

  it('produit deux lignes équilibrées', () => {
    const { lines } = buildBankEntryLines({
      statementAmount: '-1234.56',
      bankAccountCode: '521',
      counterpartAccountCode: '6315',
    });
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(1234.56, 2);
  });

  it('rejette un montant nul', () => {
    expect(() =>
      buildBankEntryLines({
        statementAmount: '0.00',
        bankAccountCode: '521',
        counterpartAccountCode: '6315',
      }),
    ).toThrow();
  });

  it('rejette un montant non numérique', () => {
    expect(() =>
      buildBankEntryLines({
        statementAmount: 'abc',
        bankAccountCode: '521',
        counterpartAccountCode: '6315',
      }),
    ).toThrow();
  });

  it('rejette une contrepartie identique au compte banque', () => {
    expect(() =>
      buildBankEntryLines({
        statementAmount: '-100.00',
        bankAccountCode: '521100',
        counterpartAccountCode: '521100',
      }),
    ).toThrow();
  });
});
