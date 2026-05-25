import {
  proposeAutoMatches,
  proposeAutoMatchesV2,
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

describe('proposeAutoMatchesV2 — N:M matching', () => {
  it('falls back to 1:1 when enableMultiLine is false (rétrocompat)', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'X', amount: '300.00' },
    ];
    // Combo de 2 lignes possible (100 + 200), mais multiLine désactivé.
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'A', signedAmount: '100.00' },
      { id: 'e2', entryDate: '2026-03-15', description: 'B', signedAmount: '200.00' },
    ];
    const r = proposeAutoMatchesV2(st, en);
    expect(r).toHaveLength(0);
  });

  it('produces 1:N proposal — exact sum of 2 lines', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'VIR GROUP', amount: '300.00' },
    ];
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'A', signedAmount: '100.00' },
      { id: 'e2', entryDate: '2026-03-15', description: 'B', signedAmount: '200.00' },
    ];
    const r = proposeAutoMatchesV2(st, en, { enableMultiLine: true });
    expect(r).toHaveLength(1);
    expect(r[0].matchType).toBe('1_to_n');
    expect(r[0].journalEntryLineIds).toHaveLength(2);
    expect(new Set(r[0].journalEntryLineIds)).toEqual(new Set(['e1', 'e2']));
  });

  it('produces 1:N proposal — exact sum of 3 lines', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'BATCH', amount: '600.00' },
    ];
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'A', signedAmount: '100.00' },
      { id: 'e2', entryDate: '2026-03-15', description: 'B', signedAmount: '200.00' },
      { id: 'e3', entryDate: '2026-03-16', description: 'C', signedAmount: '300.00' },
    ];
    const r = proposeAutoMatchesV2(st, en, { enableMultiLine: true });
    expect(r).toHaveLength(1);
    expect(r[0].journalEntryLineIds).toHaveLength(3);
  });

  it('accepts combination within positive amountTolerance', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'X', amount: '300.00' },
    ];
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'A', signedAmount: '100.50' },
      { id: 'e2', entryDate: '2026-03-15', description: 'B', signedAmount: '199.00' },
    ];
    const r = proposeAutoMatchesV2(st, en, { enableMultiLine: true, amountTolerance: 1 });
    expect(r).toHaveLength(1);
    expect(r[0].matchType).toBe('1_to_n');
  });

  it('rejects combination exceeding amountTolerance', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'X', amount: '300.00' },
    ];
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'A', signedAmount: '95.00' },
      { id: 'e2', entryDate: '2026-03-15', description: 'B', signedAmount: '200.00' },
    ];
    const r = proposeAutoMatchesV2(st, en, { enableMultiLine: true, amountTolerance: 1 });
    expect(r).toHaveLength(0);
  });

  it('respects maxCombinationSize cap', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'BIG', amount: '400.00' },
    ];
    // 4 lignes nécessaires pour atteindre 400 (100×4).
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'A', signedAmount: '100.00' },
      { id: 'e2', entryDate: '2026-03-15', description: 'B', signedAmount: '100.00' },
      { id: 'e3', entryDate: '2026-03-15', description: 'C', signedAmount: '100.00' },
      { id: 'e4', entryDate: '2026-03-15', description: 'D', signedAmount: '100.00' },
    ];
    const r = proposeAutoMatchesV2(st, en, { enableMultiLine: true, maxCombinationSize: 3 });
    expect(r).toHaveLength(0);
  });

  it('does not reuse entry lines across proposals', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'X', amount: '300.00' },
      { id: 's2', operationDate: '2026-03-15', label: 'Y', amount: '300.00' },
    ];
    // Une seule combo possible (e1+e2=300) ; pas de doublon entre s1 et s2.
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'A', signedAmount: '100.00' },
      { id: 'e2', entryDate: '2026-03-15', description: 'B', signedAmount: '200.00' },
    ];
    const r = proposeAutoMatchesV2(st, en, { enableMultiLine: true });
    // Une seule proposition (s1 prend e1+e2 ; s2 reste sans candidat).
    expect(r.filter((p) => p.matchType === '1_to_n')).toHaveLength(1);
    const allEntryIds = r.flatMap((p) => p.journalEntryLineIds);
    expect(new Set(allEntryIds).size).toBe(allEntryIds.length);
  });

  it('prefers 1:1 exact match over 1:N combination', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'X', amount: '300.00' },
    ];
    // Combo possible (100+200=300) mais aussi 1:1 direct (300).
    const en: AutoMatchInputEntryLine[] = [
      { id: 'e1', entryDate: '2026-03-15', description: 'A', signedAmount: '100.00' },
      { id: 'e2', entryDate: '2026-03-15', description: 'B', signedAmount: '200.00' },
      { id: 'e3', entryDate: '2026-03-15', description: 'X', signedAmount: '300.00' },
    ];
    const r = proposeAutoMatchesV2(st, en, { enableMultiLine: true });
    expect(r).toHaveLength(1);
    expect(r[0].matchType).toBe('1_to_1');
    expect(r[0].journalEntryLineIds).toEqual(['e3']);
  });

  it('performance: handles 50 candidate lines under 500ms', () => {
    const st: AutoMatchInputStatementLine[] = [
      { id: 's1', operationDate: '2026-03-15', label: 'BATCH', amount: '750.00' },
    ];
    const en: AutoMatchInputEntryLine[] = Array.from({ length: 50 }, (_, i) => ({
      id: `e${i}`,
      entryDate: '2026-03-15',
      description: `Op ${i}`,
      signedAmount: (10 + i * 5).toFixed(2), // 10, 15, 20, … 255
    }));
    const start = Date.now();
    proposeAutoMatchesV2(st, en, {
      enableMultiLine: true,
      maxCombinationSize: 5,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
