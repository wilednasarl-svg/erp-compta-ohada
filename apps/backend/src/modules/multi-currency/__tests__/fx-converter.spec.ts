import { composeRates, convertAmount, invertRate, roundDecimal } from '../services/fx-converter';

describe('FxConverter', () => {
  // ─── convertAmount ──────────────────────────────────────────────────

  describe('convertAmount — identity', () => {
    it('returns same amount when from === to (XOF)', () => {
      const result = convertAmount({
        amount: 100000,
        fromCurrency: 'XOF',
        toCurrency: 'XOF',
        toDecimalPlaces: 0,
      });
      expect(result.amount).toBe('100000');
      expect(result.currency).toBe('XOF');
      expect(result.appliedRate).toBe('1');
    });

    it('returns same amount when from === to (EUR with cents)', () => {
      const result = convertAmount({
        amount: '123.45',
        fromCurrency: 'EUR',
        toCurrency: 'EUR',
        toDecimalPlaces: 2,
      });
      expect(result.amount).toBe('123.45');
    });

    it('normalizes 0-decimal currency on identity (strips cents)', () => {
      const result = convertAmount({
        amount: '100000.50',
        fromCurrency: 'XOF',
        toCurrency: 'XOF',
        toDecimalPlaces: 0,
      });
      expect(result.amount).toBe('100001'); // 100000.50 → rounded half-away
    });
  });

  describe('convertAmount — EUR ↔ XOF (parité BCEAO 655.957)', () => {
    it('1 EUR = 656 XOF (rounded to 0 decimals)', () => {
      const result = convertAmount({
        amount: 1,
        fromCurrency: 'EUR',
        toCurrency: 'XOF',
        rate: '655.957',
        toDecimalPlaces: 0,
      });
      expect(result.amount).toBe('656'); // 655.957 → 656 (half-away)
    });

    it('1000 EUR = 655957 XOF', () => {
      const result = convertAmount({
        amount: 1000,
        fromCurrency: 'EUR',
        toCurrency: 'XOF',
        rate: '655.957',
        toDecimalPlaces: 0,
      });
      expect(result.amount).toBe('655957');
    });

    it('100000 XOF = 152.45 EUR (1/655.957)', () => {
      const result = convertAmount({
        amount: 100000,
        fromCurrency: 'XOF',
        toCurrency: 'EUR',
        rate: invertRate('655.957'),
        toDecimalPlaces: 2,
      });
      expect(Number(result.amount)).toBeCloseTo(152.45, 2);
    });
  });

  describe('convertAmount — zero short-circuit', () => {
    it('returns 0 regardless of rate when amount is 0', () => {
      const result = convertAmount({
        amount: 0,
        fromCurrency: 'USD',
        toCurrency: 'XOF',
        rate: '600.5',
        toDecimalPlaces: 0,
      });
      expect(result.amount).toBe('0');
    });

    it('does not require rate when amount is 0', () => {
      // Edge case: caller skips rate fetch entirely if amount is 0.
      const result = convertAmount({
        amount: 0,
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        rate: null,
        toDecimalPlaces: 2,
      });
      expect(result.amount).toBe('0.00');
    });
  });

  describe('convertAmount — sign preservation', () => {
    it('handles negative amounts (refunds, reversals)', () => {
      const result = convertAmount({
        amount: -500,
        fromCurrency: 'EUR',
        toCurrency: 'XOF',
        rate: '655.957',
        toDecimalPlaces: 0,
      });
      expect(result.amount).toBe('-327979'); // -500 × 655.957 = -327978.5 → -327979 half-away
    });
  });

  describe('convertAmount — validation', () => {
    it('rejects malformed currency codes (length / charset)', () => {
      for (const bad of ['EU', 'EURO', 'EU1', 'E-R']) {
        expect(() =>
          convertAmount({
            amount: 1,
            fromCurrency: bad,
            toCurrency: 'XOF',
            rate: '655.957',
          }),
        ).toThrow(/Invalid ISO 4217/);
      }
    });

    it('accepts lowercase ISO 4217 (auto-uppercase)', () => {
      const result = convertAmount({
        amount: 1,
        fromCurrency: 'eur',
        toCurrency: 'xof',
        rate: '655.957',
        toDecimalPlaces: 0,
      });
      expect(result.currency).toBe('XOF');
      expect(result.amount).toBe('656');
    });

    it('rejects missing rate when from !== to', () => {
      expect(() =>
        convertAmount({
          amount: 100,
          fromCurrency: 'USD',
          toCurrency: 'XOF',
          rate: null,
        }),
      ).toThrow(/rate is required/);
    });

    it('rejects non-positive rate', () => {
      for (const r of [0, -1, -0.5]) {
        expect(() =>
          convertAmount({
            amount: 100,
            fromCurrency: 'USD',
            toCurrency: 'XOF',
            rate: r,
          }),
        ).toThrow(/positive/);
      }
    });

    it('rejects non-finite values', () => {
      expect(() =>
        convertAmount({
          amount: Infinity,
          fromCurrency: 'USD',
          toCurrency: 'XOF',
          rate: 600,
        }),
      ).toThrow(/Invalid amount/);

      expect(() =>
        convertAmount({
          amount: 100,
          fromCurrency: 'USD',
          toCurrency: 'XOF',
          rate: Number.NaN,
        }),
      ).toThrow(/positive/);
    });

    it('rejects unsupported decimal places', () => {
      expect(() =>
        convertAmount({
          amount: 1,
          fromCurrency: 'XOF',
          toCurrency: 'XOF',
          // @ts-expect-error — test the runtime guard against TS escape.
          toDecimalPlaces: 5,
        }),
      ).toThrow(/DecimalPlaces/);
    });
  });

  // ─── invertRate ─────────────────────────────────────────────────────

  describe('invertRate', () => {
    it('inverts the BCEAO parity (655.957 → ~0.001524)', () => {
      const inv = invertRate('655.957');
      expect(Number(inv)).toBeCloseTo(0.0015245, 6);
    });

    it('round-trip composition stays close to identity', () => {
      const forward = '655.957';
      const back = invertRate(forward);
      // 1 EUR × 655.957 = 655.957 XOF ; 655.957 XOF × (1/655.957) = 1 EUR.
      const result = convertAmount({
        amount: 1 * Number(forward),
        fromCurrency: 'XOF',
        toCurrency: 'EUR',
        rate: back,
        toDecimalPlaces: 2,
      });
      expect(Number(result.amount)).toBeCloseTo(1.0, 2);
    });

    it('rejects zero or negative rates', () => {
      expect(() => invertRate(0)).toThrow();
      expect(() => invertRate(-1)).toThrow();
    });
  });

  // ─── composeRates ───────────────────────────────────────────────────

  describe('composeRates (triangular)', () => {
    it('USD→XOF via USD→EUR + EUR→XOF', () => {
      // Suppose 1 USD = 0.92 EUR ; 1 EUR = 655.957 XOF
      // ⇒ 1 USD = 0.92 × 655.957 = 603.48 XOF
      const triangular = composeRates('0.92', '655.957');
      expect(Number(triangular)).toBeCloseTo(603.48, 1);

      const result = convertAmount({
        amount: 1000,
        fromCurrency: 'USD',
        toCurrency: 'XOF',
        rate: triangular,
        toDecimalPlaces: 0,
      });
      expect(Number(result.amount)).toBeGreaterThan(600000);
      expect(Number(result.amount)).toBeLessThan(610000);
    });

    it('rejects invalid rate components', () => {
      expect(() => composeRates(0, 1)).toThrow();
      expect(() => composeRates(1, -1)).toThrow();
    });
  });

  // ─── roundDecimal ───────────────────────────────────────────────────

  describe('roundDecimal — half-away-from-zero (OHADA)', () => {
    it('rounds positive values away from zero', () => {
      expect(roundDecimal(1.235, 2)).toBe('1.24');
      expect(roundDecimal(1.225, 2)).toBe('1.23');
      expect(roundDecimal(0.5, 0)).toBe('1');
    });

    it('rounds negative values away from zero (symmetric)', () => {
      expect(roundDecimal(-1.235, 2)).toBe('-1.24');
      expect(roundDecimal(-0.5, 0)).toBe('-1');
    });

    it('handles 0-decimal currency (XOF)', () => {
      expect(roundDecimal(655.957, 0)).toBe('656');
      expect(roundDecimal(655.4, 0)).toBe('655');
      expect(roundDecimal(0.1, 0)).toBe('0');
    });

    it('handles 3-decimal currency (BHD)', () => {
      expect(roundDecimal(1.2345, 3)).toBe('1.235');
      expect(roundDecimal(1.0005, 3)).toBe('1.001');
    });

    it('rejects non-finite values', () => {
      expect(() => roundDecimal(Number.NaN, 2)).toThrow();
      expect(() => roundDecimal(Infinity, 2)).toThrow();
    });
  });
});
