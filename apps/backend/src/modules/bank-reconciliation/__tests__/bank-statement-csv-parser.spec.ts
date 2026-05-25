import { BankCsvParseError, parseBankCsv } from '../services/bank-statement-csv-parser';

describe('parseBankCsv', () => {
  describe('happy path', () => {
    it('parses comma-separated CSV with split debit/credit columns', () => {
      const csv = [
        'date_operation,date_valeur,libelle,reference,debit,credit',
        '2026-03-15,2026-03-16,VIREMENT ACME SARL,VIR123,,1500000.00',
        '2026-03-18,2026-03-18,FRAIS TENUE COMPTE,FR456,2500.00,',
      ].join('\n');

      const result = parseBankCsv(csv);

      expect(result.detectedSeparator).toBe(',');
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0].amount).toBe('1500000.00');
      expect(result.lines[1].amount).toBe('-2500.00');
    });

    it('parses semicolon-separated CSV with single signed amount column', () => {
      const csv = [
        'date_operation;libelle;montant',
        '15/03/2026;Encaissement client;1500000,00',
        '18/03/2026;Frais bancaires;-2500,00',
      ].join('\n');

      const result = parseBankCsv(csv);

      expect(result.detectedSeparator).toBe(';');
      expect(result.lines).toHaveLength(2);
      expect(result.lines[0].operationDate).toBe('2026-03-15');
      expect(result.lines[0].amount).toBe('1500000.00');
    });

    it('parses tab-separated CSV', () => {
      const csv = ['date_operation\tlibelle\tmontant', '2026-03-15\tACME\t1000.00'].join('\n');
      const result = parseBankCsv(csv);
      expect(result.detectedSeparator).toBe('\t');
      expect(result.lines).toHaveLength(1);
    });

    it('strips UTF-8 BOM and Windows CRLF', () => {
      const csv = '﻿date_operation,libelle,montant\r\n2026-03-15,ACME,1000.00\r\n';
      const result = parseBankCsv(csv);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].label).toBe('ACME');
    });

    it('returns empty array for empty input', () => {
      expect(parseBankCsv('').lines).toHaveLength(0);
    });

    it('skips blank rows', () => {
      const csv = [
        'date_operation,libelle,montant',
        '2026-03-15,ACME,1000.00',
        '',
        '   ',
        '2026-03-16,BETA,500.00',
      ].join('\n');
      const result = parseBankCsv(csv);
      expect(result.lines).toHaveLength(2);
    });

    it('handles quoted fields containing separator', () => {
      const csv = [
        'date_operation,libelle,montant',
        '2026-03-15,"VIR ACME, SARL",1500000.00',
      ].join('\n');
      const result = parseBankCsv(csv);
      expect(result.lines[0].label).toBe('VIR ACME, SARL');
    });

    it('handles space-grouped thousands', () => {
      const csv = ['date_operation,libelle,montant', '2026-03-15,ACME,1 500 000,00'].join('\n');
      const result = parseBankCsv(csv);
      expect(result.lines[0].amount).toBe('1500000.00');
    });
  });

  describe('validation errors', () => {
    it('rejects when no date column', () => {
      expect(() => parseBankCsv('libelle,montant\nX,100.00')).toThrow(BankCsvParseError);
    });

    it('rejects when no label column', () => {
      expect(() => parseBankCsv('date_operation,montant\n2026-03-15,100.00')).toThrow(
        BankCsvParseError,
      );
    });

    it('rejects when no amount column', () => {
      expect(() => parseBankCsv('date_operation,libelle\n2026-03-15,X')).toThrow(BankCsvParseError);
    });

    it('rejects empty label', () => {
      expect(() => parseBankCsv('date_operation,libelle,montant\n2026-03-15,,1000.00')).toThrow(
        BankCsvParseError,
      );
    });

    it('rejects zero amount', () => {
      expect(() => parseBankCsv('date_operation,libelle,montant\n2026-03-15,ACME,0.00')).toThrow(
        BankCsvParseError,
      );
    });

    it('rejects both debit and credit positive', () => {
      const csv =
        'date_operation,libelle,debit,credit\n2026-03-15,ACME,100.00,200.00';
      expect(() => parseBankCsv(csv)).toThrow(BankCsvParseError);
    });

    it('rejects invalid date', () => {
      expect(() => parseBankCsv('date_operation,libelle,montant\ninvalid,ACME,1000')).toThrow(
        BankCsvParseError,
      );
    });

    it('rejects invalid amount', () => {
      expect(() => parseBankCsv('date_operation,libelle,montant\n2026-03-15,ACME,NaN')).toThrow(
        BankCsvParseError,
      );
    });

    it('reports failing row index', () => {
      const csv = [
        'date_operation,libelle,montant',
        '2026-03-15,ACME,1000.00',
        '2026-03-16,BETA,not-a-number',
      ].join('\n');
      try {
        parseBankCsv(csv);
        fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BankCsvParseError);
        expect((e as BankCsvParseError).rowIndex).toBe(2);
      }
    });
  });
});
