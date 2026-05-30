import { buildHeaderMap, mapTemplateRow, normalizeHeader, type RawRecord } from './budget-template';

describe('budget-template', () => {
  describe('normalizeHeader', () => {
    it('strips accents, lowercases, and normalizes separators', () => {
      expect(normalizeHeader('Montant Budgété')).toBe('montant_budgete');
      expect(normalizeHeader('Code-Compte')).toBe('code_compte');
    });
  });

  describe('buildHeaderMap', () => {
    it('maps FR and EN aliases to canonical fields', () => {
      const map = buildHeaderMap(['Année', 'account', 'Montant', 'FX']);
      expect(map.get('Année')).toBe('exercice');
      expect(map.get('account')).toBe('code_compte');
      expect(map.get('Montant')).toBe('montant_budgete');
      expect(map.get('FX')).toBe('taux_change');
    });
  });

  describe('mapTemplateRow', () => {
    const headers = [
      'exercice',
      'periode',
      'type_budget',
      'code_compte',
      'code_cc',
      'montant_budgete',
    ];
    const headerMap = buildHeaderMap(headers);

    it('parses a valid monthly OPEX row', () => {
      const record: RawRecord = {
        exercice: '2026',
        periode: '2026-03',
        type_budget: 'opex',
        code_compte: '6221',
        code_cc: 'COMM',
        montant_budgete: '1 500 000,00',
      };
      const result = mapTemplateRow(record, headerMap);
      expect('row' in result).toBe(true);
      if ('row' in result) {
        expect(result.row.fiscalYear).toBe(2026);
        expect(result.row.periodMonth).toBe(3);
        expect(result.row.budgetType).toBe('OPEX');
        expect(result.row.scenario).toBe('BI');
        expect(result.row.costCenterCode).toBe('COMM');
        expect(result.row.amount).toBe('1500000.00');
        expect(result.row.currency).toBe('XOF');
        expect(result.row.exchangeRate).toBe('1');
      }
    });

    it('treats an empty period as an annual line', () => {
      const result = mapTemplateRow(
        {
          exercice: '2026',
          periode: '',
          type_budget: 'CAPEX',
          code_compte: '2441',
          montant_budgete: '12000000',
        },
        headerMap,
      );
      expect('row' in result && result.row.periodMonth).toBeNull();
    });

    it('accepts a negative amount (treasury outflow)', () => {
      const result = mapTemplateRow(
        {
          exercice: '2026',
          periode: '2026-04',
          type_budget: 'TRESO',
          code_compte: '521',
          montant_budgete: '-12000000',
        },
        headerMap,
      );
      expect('row' in result && result.row.amount).toBe('-12000000');
    });

    it('collects errors for an invalid row', () => {
      const result = mapTemplateRow(
        {
          exercice: '99',
          periode: '2026-13',
          type_budget: 'XXX',
          code_compte: 'ABC',
          montant_budgete: 'oops',
        },
        headerMap,
      );
      expect('errors' in result).toBe(true);
      if ('errors' in result) {
        expect(result.errors.length).toBeGreaterThanOrEqual(4);
      }
    });
  });
});
