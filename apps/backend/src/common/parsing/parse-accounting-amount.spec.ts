import { parseAccountingAmount } from './parse-accounting-amount';

describe('parseAccountingAmount', () => {
  it('parses US/English format (comma thousands, dot decimal)', () => {
    expect(parseAccountingAmount('4,340,000.00')).toBe(4_340_000);
    expect(parseAccountingAmount('196,750,000.00')).toBe(196_750_000);
    expect(parseAccountingAmount('100,000,000.00')).toBe(100_000_000);
    expect(parseAccountingAmount('1,234.56')).toBe(1_234.56);
  });

  it('parses comma-thousands WITHOUT a decimal part (régression Blance CSV)', () => {
    // Bug : `100,000,000` était lu 100000.000 = 100 000 (÷1000), ce qui
    // amputait le débit importé et faussait l'équilibre du bilan.
    expect(parseAccountingAmount('100,000,000')).toBe(100_000_000);
    expect(parseAccountingAmount('20,000,000')).toBe(20_000_000);
    expect(parseAccountingAmount('1,885,629,834')).toBe(1_885_629_834);
    expect(parseAccountingAmount('236,953,148')).toBe(236_953_148);
    expect(parseAccountingAmount('13,561,223,572')).toBe(13_561_223_572);
  });

  it('parses dot-thousands WITHOUT a decimal part (FR sans décimale)', () => {
    expect(parseAccountingAmount('1.234.567')).toBe(1_234_567);
    expect(parseAccountingAmount('100.000.000')).toBe(100_000_000);
  });

  it('parses French format (space/dot thousands, comma decimal)', () => {
    expect(parseAccountingAmount('1 234 567,89')).toBe(1_234_567.89);
    expect(parseAccountingAmount('1.234.567,89')).toBe(1_234_567.89);
    expect(parseAccountingAmount('1 234,56')).toBe(1_234.56);
    expect(parseAccountingAmount('1500,00')).toBe(1_500);
  });

  it('parses plain numbers and single decimal separators', () => {
    expect(parseAccountingAmount('4059.06')).toBe(4_059.06);
    expect(parseAccountingAmount('4059,06')).toBe(4_059.06);
    expect(parseAccountingAmount('4059060')).toBe(4_059_060);
    expect(parseAccountingAmount('100')).toBe(100);
  });

  it('treats a lone separator + exactly 3 digits as thousands', () => {
    expect(parseAccountingAmount('1,234')).toBe(1_234);
    expect(parseAccountingAmount('1.234')).toBe(1_234);
  });

  it('treats a lone separator + 1-2 digits as decimal', () => {
    expect(parseAccountingAmount('1,23')).toBe(1.23);
    expect(parseAccountingAmount('1.2')).toBe(1.2);
  });

  it('handles negatives (minus and accounting parentheses)', () => {
    expect(parseAccountingAmount('-100')).toBe(-100);
    expect(parseAccountingAmount('-1 234,00')).toBe(-1_234);
    expect(parseAccountingAmount('(1,234.00)')).toBe(-1_234);
  });

  it('passes through native numbers', () => {
    expect(parseAccountingAmount(4_340_000)).toBe(4_340_000);
    expect(parseAccountingAmount(0)).toBe(0);
  });

  it('returns NaN for empty / non-numeric input', () => {
    expect(Number.isNaN(parseAccountingAmount(''))).toBe(true);
    expect(Number.isNaN(parseAccountingAmount('   '))).toBe(true);
    expect(Number.isNaN(parseAccountingAmount(null))).toBe(true);
    expect(Number.isNaN(parseAccountingAmount(undefined))).toBe(true);
    expect(Number.isNaN(parseAccountingAmount('abc'))).toBe(true);
  });

  it('preserves the existing FR validation cases (no regression)', () => {
    // Cas couverts par validation.service.spec — doivent rester identiques.
    expect(parseAccountingAmount('1 234,56')).toBe(1_234.56);
    expect(parseAccountingAmount('200,00')).toBe(200);
    expect(parseAccountingAmount('500')).toBe(500);
  });
});
