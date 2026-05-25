import {
  proposeAutoMatches,
  type AutoMatchInputEntryLine,
  type AutoMatchInputStatementLine,
} from '../services/auto-match-algorithm';

describe('proposeAutoMatches', () => {
  it('returns empty when no statement lines', () => {
    const proposals = proposeAutoMatches(
      [],
      [{ id: 'e1', entryDate: '2026-03-15', description: 'X', signedAmount: '100.00' }],
    );
    expect(proposals).toHaveLength(0);
  });

  it('returns empty when no entry lines', () => {
    const proposals = proposeAutoMatches(
      [{ id: 's1', operationDate: '2026-03-15', label: 'X', amount: '100.00' }],
      [],
    );
    expect(proposals).toHaveLength(0);
  });

  it('matches exact amount same date with confidence 100', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'VIR ACME', amount: '1500000.00' },
    ];
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'VIR ACME', signedAmount: '1500000.00' },
    ];
    const r = proposeAutoMatches(st, en);
    expect(r).toHaveLength(1);
    expect(r[0].confidenceScore).toBe(100);
  });

  it('rejects amount mismatch', () => {
    const r = proposeAutoMatches(
      [{ id: 's1', operationDate: '2026-03-15', label: 'X', amount: '100.00' }],
      [{ id: 'e1', entryDate: '2026-03-15', description: 'X', signedAmount: '101.00' }],
    );
    expect(r).toHaveLength(0);
  });

  it('rejects date beyond window', () => {
    const r = proposeAutoMatches(
      [{ id: 's1', operationDate: '2026-03-15', label: 'X', amount: '100.00' }],
      [{ id: 'e1', entryDate: '2026-04-01', description: 'X', signedAmount: '100.00' }],
    );
    expect(r).toHaveLength(0);
  });

  it('enforces 1:1 statement → entry', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'X', amount: '100.00' },
    ];
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'X', signedAmount: '100.00' },
      { id: 'e2', entryDate: '2026-03-15', description: 'X', signedAmount: '100.00' },
    ];
    expect(proposeAutoMatches(st, en)).toHaveLength(1);
  });

  it('enforces 1:1 entry → statement', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'X', amount: '100.00' },
      { id: 's2', operationDate: '2026-03-15', label: 'X', amount: '100.00' },
    ];
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'X', signedAmount: '100.00' },
    ];
    expect(proposeAutoMatches(st, en)).toHaveLength(1);
  });

  it('prefers highest-scoring candidate', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'VIR ACME SARL', amount: '100.00' },
    ];
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e_far', entryDate: '2026-03-18', description: 'XXXX', signedAmount: '100.00' },
      {
        id: 'e_close',
        entryDate: '2026-03-15',
        description: 'VIR ACME SARL',
        signedAmount: '100.00',
      },
    ];
    const r = proposeAutoMatches(st, en);
    expect(r[0].journalEntryLineId).toBe('e_close');
  });

  it('respects custom minScore', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'X', amount: '100.00' },
    ];
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-19', description: 'Y', signedAmount: '100.00' },
    ];
    expect(proposeAutoMatches(st, en, { minScore: 80 })).toHaveLength(0);
    expect(proposeAutoMatches(st, en, { minScore: 10 })).toHaveLength(1);
  });

  it('matches negative amounts (bank debit)', () => {
    const r = proposeAutoMatches(
      [{ id: 's1', operationDate: '2026-03-15', label: 'FRAIS', amount: '-2500.00' }],
      [{ id: 'e1', entryDate: '2026-03-15', description: 'FRAIS', signedAmount: '-2500.00' }],
    );
    expect(r).toHaveLength(1);
  });
});
