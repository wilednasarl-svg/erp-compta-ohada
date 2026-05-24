import { classifyForBilan } from '../services/ohada-classifier';

describe('classifyForBilan', () => {
  it('class 2 → ACTIF immobilisé regardless of sign', () => {
    expect(classifyForBilan('211000', 2, 'D')).toEqual({ side: 'ACTIF', key: 'IMMOBILISE' });
    // Cumulated depreciation (28x) is on credit but still actif immobilisé
    // by SYSCOHADA convention — netted off against the gross immo.
    expect(classifyForBilan('281000', 2, 'C')).toEqual({ side: 'ACTIF', key: 'IMMOBILISE' });
  });

  it('class 1 with prefix 10-15 → capitaux propres', () => {
    expect(classifyForBilan('101000', 1, 'C')).toEqual({
      side: 'PASSIF',
      key: 'CAPITAUX_PROPRES',
    });
    expect(classifyForBilan('151000', 1, 'C')).toEqual({
      side: 'PASSIF',
      key: 'CAPITAUX_PROPRES',
    });
  });

  it('class 1 with prefix ≥16 → dettes financières', () => {
    expect(classifyForBilan('161000', 1, 'C')).toEqual({
      side: 'PASSIF',
      key: 'DETTES_FINANCIERES',
    });
    expect(classifyForBilan('181000', 1, 'C')).toEqual({
      side: 'PASSIF',
      key: 'DETTES_FINANCIERES',
    });
  });

  it('class 3 → ACTIF circulant (stocks)', () => {
    expect(classifyForBilan('311000', 3, 'D')).toEqual({ side: 'ACTIF', key: 'CIRCULANT' });
  });

  it('class 4 debit → ACTIF circulant (créance)', () => {
    expect(classifyForBilan('411000', 4, 'D')).toEqual({ side: 'ACTIF', key: 'CIRCULANT' });
  });

  it('class 4 credit → PASSIF circulant (dette)', () => {
    expect(classifyForBilan('401000', 4, 'C')).toEqual({
      side: 'PASSIF',
      key: 'PASSIF_CIRCULANT',
    });
  });

  it('class 5 debit → trésorerie actif', () => {
    expect(classifyForBilan('512000', 5, 'D')).toEqual({
      side: 'ACTIF',
      key: 'TRESORERIE_ACTIF',
    });
  });

  it('class 5 credit → trésorerie passif (découvert bancaire)', () => {
    expect(classifyForBilan('512000', 5, 'C')).toEqual({
      side: 'PASSIF',
      key: 'TRESORERIE_PASSIF',
    });
  });

  it.each([6, 7, 8, 9])('class %i → null (P&L / HAO / analytique, not Bilan)', (klass) => {
    expect(classifyForBilan('600000', klass, 'D')).toBeNull();
  });

  it('class 0 / class 10 → null (out of OHADA range)', () => {
    expect(classifyForBilan('000000', 0, 'D')).toBeNull();
    expect(classifyForBilan('xxxxxx', 10, 'D')).toBeNull();
  });
});
