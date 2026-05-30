// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseAccountingAmount } from './parse-amount';

describe('parseAccountingAmount', () => {
  it('parses US/English format (comma thousands, dot decimal)', () => {
    expect(parseAccountingAmount('4,340,000.00')).toBe(4_340_000);
    expect(parseAccountingAmount('196,750,000.00')).toBe(196_750_000);
    expect(parseAccountingAmount('53,990,000.00')).toBe(53_990_000);
    expect(parseAccountingAmount('1,234.56')).toBe(1_234.56);
  });

  it('parses French format (space/dot thousands, comma decimal)', () => {
    expect(parseAccountingAmount('1 234 567,89')).toBe(1_234_567.89);
    expect(parseAccountingAmount('1.234.567,89')).toBe(1_234_567.89);
    expect(parseAccountingAmount('100 000,00')).toBe(100_000);
  });

  it('parses non-breaking-space thousands separators (Excel FR export)', () => {
    expect(parseAccountingAmount('1 234 567,89')).toBe(1_234_567.89);
  });

  it('parses plain numbers with single decimal separator', () => {
    expect(parseAccountingAmount('4059.06')).toBe(4_059.06);
    expect(parseAccountingAmount('4059,06')).toBe(4_059.06);
    expect(parseAccountingAmount('4059060')).toBe(4_059_060);
  });

  it('treats a lone separator followed by exactly 3 digits as thousands', () => {
    expect(parseAccountingAmount('1,234')).toBe(1_234);
    expect(parseAccountingAmount('1.234')).toBe(1_234);
  });

  it('treats a lone separator followed by 1-2 digits as decimal', () => {
    expect(parseAccountingAmount('1,23')).toBe(1.23);
    expect(parseAccountingAmount('1.2')).toBe(1.2);
  });

  it('handles currency symbols and stray text', () => {
    expect(parseAccountingAmount('FCFA 100 000,00')).toBe(100_000);
    expect(parseAccountingAmount('1 234,50 €')).toBe(1_234.5);
  });

  it('handles accounting negatives (parentheses and minus sign)', () => {
    expect(parseAccountingAmount('(1,234.00)')).toBe(-1_234);
    expect(parseAccountingAmount('-1 234,00')).toBe(-1_234);
  });

  it('passes through native numbers unchanged', () => {
    expect(parseAccountingAmount(4_340_000)).toBe(4_340_000);
    expect(parseAccountingAmount(0)).toBe(0);
  });

  it('returns NaN for empty or non-numeric input', () => {
    expect(Number.isNaN(parseAccountingAmount(''))).toBe(true);
    expect(Number.isNaN(parseAccountingAmount('   '))).toBe(true);
    expect(Number.isNaN(parseAccountingAmount(null))).toBe(true);
    expect(Number.isNaN(parseAccountingAmount('—'))).toBe(true);
  });

  it('regression: the exact values from the broken balance screenshot', () => {
    // Avant correction, parseAmt rendait 4.34 / 196.75 / 53.99 (faux).
    expect(parseAccountingAmount('4,340,000.00')).toBe(4_340_000);
    expect(parseAccountingAmount('196,750,000.00')).toBe(196_750_000);
    expect(parseAccountingAmount('53,990,000.00')).toBe(53_990_000);
    expect(parseAccountingAmount('100,000,000.00')).toBe(100_000_000);
  });

  it('parses US-format INTEGERS without decimals (multi-comma thousands)', () => {
    // Régression : Excel rend souvent les entiers sans décimales → "100,000,000".
    // L'ancienne règle "dernier groupe = décimale" donnait 100000 (÷1000).
    expect(parseAccountingAmount('100,000,000')).toBe(100_000_000);
    expect(parseAccountingAmount('1,885,629,834')).toBe(1_885_629_834);
    expect(parseAccountingAmount('1,160,979,180')).toBe(1_160_979_180);
    expect(parseAccountingAmount('236,953,148')).toBe(236_953_148);
    // Idem format français (point milliers) sans décimale.
    expect(parseAccountingAmount('1.885.629.834')).toBe(1_885_629_834);
  });
});
