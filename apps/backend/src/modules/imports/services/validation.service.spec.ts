import type { MappedRow } from '../types/mapping';
import {
  ValidationService,
  findParentAccountByPrefix,
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
    pieceNumber: 'P-001',
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

    it('requires pieceNumber for entries (mandatory — décision produit)', () => {
      const { pieceNumber: _omit, ...withoutPiece } = baseRow();
      const errors = service.validateRow(withoutPiece, { chart: baseChart });

      expect(
        errors.some((e) => e.code === 'missing_required_field' && e.field === 'pieceNumber'),
      ).toBe(true);
    });

    it('does not require pieceNumber for a trial_balance (no piece per line)', () => {
      const { pieceNumber: _omit, ...withoutPiece } = baseRow();
      const errors = service.validateRow(
        { ...withoutPiece, journal: null, date: null },
        { chart: baseChart, documentType: 'trial_balance' },
      );

      expect(
        errors.some((e) => e.code === 'missing_required_field' && e.field === 'pieceNumber'),
      ).toBe(false);
    });
  });

  describe('validateRow — due date', () => {
    it('accepts a parseable due date', () => {
      expect(
        service.validateRow({ ...baseRow(), dueDate: '30/04/2024' }, { chart: baseChart }),
      ).toEqual([]);
    });

    it('flags an unparseable due date with field dueDate', () => {
      const errors = service.validateRow(
        { ...baseRow(), dueDate: 'pas-une-date' },
        { chart: baseChart },
      );
      expect(errors.some((e) => e.code === 'invalid_date' && e.field === 'dueDate')).toBe(true);
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

  // ─── documentType-aware validation (trial_balance + cumulative docs) ─

  describe('validateRow — documentType trial_balance', () => {
    const balanceRow = (overrides: Partial<MappedRow> = {}): MappedRow => ({
      account: '4111',
      label: 'Clients',
      debit: '1500,00',
      credit: '200,00',
      ...overrides,
    });

    it('does NOT flag missing journal/date on a balance row', () => {
      const errors = service.validateRow(balanceRow(), {
        chart: baseChart,
        documentType: 'trial_balance',
      });
      const missingFields = errors
        .filter((e) => e.code === 'missing_required_field')
        .map((e) => e.field);
      expect(missingFields).not.toContain('journal');
      expect(missingFields).not.toContain('date');
    });

    it('still flags missing account and label on a balance row', () => {
      const errors = service.validateRow(
        { account: null, label: null, debit: '100', credit: '0' },
        { chart: baseChart, documentType: 'trial_balance' },
      );
      const missingFields = errors
        .filter((e) => e.code === 'missing_required_field')
        .map((e) => e.field);
      expect(missingFields).toEqual(expect.arrayContaining(['account', 'label']));
    });

    it('accepts debit > 0 AND credit > 0 simultaneously (cumulative semantics)', () => {
      const errors = service.validateRow(balanceRow({ debit: '500', credit: '300' }), {
        chart: baseChart,
        documentType: 'trial_balance',
      });
      expect(errors.some((e) => e.code === 'debit_credit_both_nonzero')).toBe(false);
    });

    it('accepts a zero/zero line on a balance (account without movement)', () => {
      const errors = service.validateRow(balanceRow({ debit: '0', credit: '0' }), {
        chart: baseChart,
        documentType: 'trial_balance',
      });
      expect(errors.some((e) => e.code === 'debit_credit_both_zero')).toBe(false);
    });

    it('emits unknown_account_with_parent_hint when a parent prefix exists in the reference set', () => {
      const chart: ChartAccountIndex = {
        postingCodes: new Set(['101']),
        allReferenceCodes: new Set(['10', '101']),
      };
      const errors = service.validateRow(balanceRow({ account: '10100000' }), {
        chart,
        documentType: 'trial_balance',
      });
      const hint = errors.find((e) => e.code === 'unknown_account_with_parent_hint');
      expect(hint).toBeDefined();
      expect(hint?.message).toContain('10100000');
      expect(hint?.message).toContain('101');
      // Plain unknown_account is NOT emitted in addition.
      expect(errors.some((e) => e.code === 'unknown_account')).toBe(false);
    });

    it('falls back to unknown_account when no parent prefix matches', () => {
      const chart: ChartAccountIndex = {
        postingCodes: new Set(['4111']),
        allReferenceCodes: new Set(['4111', '70110']),
      };
      const errors = service.validateRow(balanceRow({ account: '99999999' }), {
        chart,
        documentType: 'trial_balance',
      });
      expect(errors.some((e) => e.code === 'unknown_account')).toBe(true);
      expect(errors.some((e) => e.code === 'unknown_account_with_parent_hint')).toBe(false);
    });
  });

  describe('validateRow — documentType entries (regression)', () => {
    it('keeps the historical behavior when documentType is absent (default = entries)', () => {
      // Same input as the original "rejects when both debit and credit are > 0" test.
      const errors = service.validateRow(
        { ...baseRow(), debit: '100', credit: '100' },
        { chart: baseChart },
      );
      expect(errors.some((e) => e.code === 'debit_credit_both_nonzero')).toBe(true);
    });

    it('still requires journal/date/label when documentType is explicitly entries', () => {
      const errors = service.validateRow(
        { account: '4111', journal: null, date: null, label: null, debit: '100', credit: '0' },
        { chart: baseChart, documentType: 'entries' },
      );
      const missingFields = errors
        .filter((e) => e.code === 'missing_required_field')
        .map((e) => e.field);
      expect(missingFields).toEqual(expect.arrayContaining(['journal', 'date', 'label']));
    });
  });

  describe('findParentAccountByPrefix', () => {
    it('returns the longest matching prefix', () => {
      const result = findParentAccountByPrefix(
        '10100000',
        new Set<string>(),
        new Set(['10', '101', '1010']),
      );
      expect(result).toBe('1010');
    });

    it('matches against postingCodes too, not only the reference set', () => {
      const result = findParentAccountByPrefix('41100000', new Set(['411']), new Set(['41']));
      expect(result).toBe('411');
    });

    it('returns null when nothing matches', () => {
      expect(findParentAccountByPrefix('99999999', new Set(['411']), new Set(['10']))).toBeNull();
    });

    it('returns null on accounts shorter than 2 chars', () => {
      expect(findParentAccountByPrefix('1', new Set(), new Set(['1']))).toBeNull();
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
