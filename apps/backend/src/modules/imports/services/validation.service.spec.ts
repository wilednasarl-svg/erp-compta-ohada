import type { MappedRow } from '../types/mapping';
import {
  ValidationService,
  parseImportDate,
  type ChartAccountIndex,
  type FiscalYearRange,
} from './validation.service';

describe('ValidationService', () => {
  let service: ValidationService;

  const baseChart: ChartAccountIndex = {
    postingCodes: new Set(['4111', '70110', '512000']),
  };

  const baseRow = (): MappedRow => ({
    account: '4111',
    journal: 'VTE',
    date: '2024-03-15',
    debit: '1500,00',
    credit: null,
    label: 'Vente facture FAC-001',
  });

  beforeEach(() => {
    service = new ValidationService();
  });

  describe('validateRow — required fields', () => {
    it('returns no errors on a well-formed row', () => {
      expect(service.validateRow(baseRow(), { chart: baseChart })).toEqual([]);
    });

    it('flags every missing required field', () => {
      const errors = service.validateRow(
        { account: '4111', journal: null, date: '', label: '   ', debit: '100', credit: null },
        { chart: baseChart },
      );

      const codes = errors.map((e) => e.code);
      expect(codes).toContain('missing_required_field');
      const missing = errors.filter((e) => e.code === 'missing_required_field').map((e) => e.field);
      expect(missing).toEqual(expect.arrayContaining(['journal', 'date', 'label']));
    });
  });

  describe('validateRow — unknown account', () => {
    it('flags account codes absent from the posting set', () => {
      const errors = service.validateRow({ ...baseRow(), account: '999999' }, { chart: baseChart });

      expect(errors.some((e) => e.code === 'unknown_account')).toBe(true);
    });

    it('does not flag account when account field is missing (covered by missing_required_field)', () => {
      const errors = service.validateRow({ ...baseRow(), account: null }, { chart: baseChart });

      expect(errors.some((e) => e.code === 'unknown_account')).toBe(false);
      expect(errors.some((e) => e.code === 'missing_required_field' && e.field === 'account')).toBe(
        true,
      );
    });
  });

  describe('validateRow — dates', () => {
    it('accepts YYYY-MM-DD and DD/MM/YYYY', () => {
      expect(
        service.validateRow({ ...baseRow(), date: '2024-03-15' }, { chart: baseChart }),
      ).toEqual([]);
      expect(
        service.validateRow({ ...baseRow(), date: '15/03/2024' }, { chart: baseChart }),
      ).toEqual([]);
    });

    it('rejects unparseable dates', () => {
      const errors = service.validateRow(
        { ...baseRow(), date: 'not-a-date' },
        { chart: baseChart },
      );
      expect(errors.some((e) => e.code === 'invalid_date')).toBe(true);
    });

    it('rejects calendar-impossible dates (Feb 31)', () => {
      const errors = service.validateRow(
        { ...baseRow(), date: '31/02/2024' },
        { chart: baseChart },
      );
      expect(errors.some((e) => e.code === 'invalid_date')).toBe(true);
    });

    it('flags dates outside the fiscal year range', () => {
      const fiscalYear: FiscalYearRange = {
        startDate: new Date(Date.UTC(2024, 0, 1)),
        endDate: new Date(Date.UTC(2024, 11, 31)),
      };

      const errors = service.validateRow(
        { ...baseRow(), date: '2023-12-31' },
        { chart: baseChart, fiscalYear },
      );
      expect(errors.some((e) => e.code === 'date_out_of_fiscal_year')).toBe(true);
    });

    it('does not flag fiscal year when the rule is not configured', () => {
      const errors = service.validateRow(
        { ...baseRow(), date: '2099-01-01' },
        { chart: baseChart },
      );
      expect(errors.some((e) => e.code === 'date_out_of_fiscal_year')).toBe(false);
    });
  });

  describe('validateRow — debit / credit', () => {
    it('rejects when both debit and credit are zero', () => {
      const errors = service.validateRow(
        { ...baseRow(), debit: '0', credit: '0' },
        { chart: baseChart },
      );
      expect(errors.some((e) => e.code === 'debit_credit_both_zero')).toBe(true);
    });

    it('rejects when both debit and credit are > 0', () => {
      const errors = service.validateRow(
        { ...baseRow(), debit: '100', credit: '100' },
        { chart: baseChart },
      );
      expect(errors.some((e) => e.code === 'debit_credit_both_nonzero')).toBe(true);
    });

    it('accepts FR-style comma decimals and grouped spaces', () => {
      expect(
        service.validateRow(
          { ...baseRow(), debit: '1 234,56', credit: null },
          { chart: baseChart },
        ),
      ).toEqual([]);
    });

    it('rejects malformed amounts', () => {
      const errors = service.validateRow({ ...baseRow(), debit: 'abc' }, { chart: baseChart });
      expect(errors.some((e) => e.code === 'invalid_amount')).toBe(true);
    });

    it('rejects negative amounts with a distinct code', () => {
      const errors = service.validateRow({ ...baseRow(), debit: '-100' }, { chart: baseChart });
      expect(errors.some((e) => e.code === 'negative_amount')).toBe(true);
    });
  });

  describe('buildChartIndex', () => {
    it('keeps only active POSTING accounts', () => {
      const index = service.buildChartIndex([
        { code: '4111', accountType: 'POSTING', isActive: true },
        { code: '41', accountType: 'TITLE', isActive: true },
        { code: '4112', accountType: 'POSTING', isActive: false },
        { code: '5121', accountType: 'POSTING', isActive: true },
      ]);

      expect(index.postingCodes.has('4111')).toBe(true);
      expect(index.postingCodes.has('5121')).toBe(true);
      expect(index.postingCodes.has('41')).toBe(false);
      expect(index.postingCodes.has('4112')).toBe(false);
    });
  });
});

describe('parseImportDate', () => {
  it('parses YYYY-MM-DD into a UTC midnight Date', () => {
    const d = parseImportDate('2024-03-15');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2024);
    expect(d!.getUTCMonth()).toBe(2);
    expect(d!.getUTCDate()).toBe(15);
  });

  it('parses DD/MM/YYYY (FR)', () => {
    const d = parseImportDate('15/03/2024');
    expect(d).not.toBeNull();
    expect(d!.getUTCDate()).toBe(15);
    expect(d!.getUTCMonth()).toBe(2);
  });

  it('parses ISO 8601 with time', () => {
    const d = parseImportDate('2024-03-15T10:30:00Z');
    expect(d).not.toBeNull();
    expect(d!.getUTCDate()).toBe(15);
  });

  it('returns null on impossible calendar dates', () => {
    expect(parseImportDate('31/02/2024')).toBeNull();
    expect(parseImportDate('2024-13-01')).toBeNull();
  });

  it('returns null on garbage input', () => {
    expect(parseImportDate('hello')).toBeNull();
    expect(parseImportDate('')).toBeNull();
  });
});
