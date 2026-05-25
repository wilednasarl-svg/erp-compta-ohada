import { extractInvoiceMetadata } from '../services/metadata-extractor';

describe('extractInvoiceMetadata (Module 10 wave 2)', () => {
  it('returns an empty object for empty / whitespace text', () => {
    expect(extractInvoiceMetadata('')).toEqual({});
    expect(extractInvoiceMetadata('   \n\t  ')).toEqual({});
  });

  it('extracts French invoice date in DD/MM/YYYY format', () => {
    const text = 'Facture\nDate: 24/05/2026\nMontant TTC: 1 234,56 F CFA';
    const result = extractInvoiceMetadata(text);
    expect(result.invoiceDate).toBe('2026-05-24');
  });

  it('extracts ISO invoice date when labeled', () => {
    const text = 'Date de facture: 2026-05-24';
    expect(extractInvoiceMetadata(text).invoiceDate).toBe('2026-05-24');
  });

  it('extracts Total TTC in French decimal convention', () => {
    const text = 'Total TTC: 1 234,56';
    expect(extractInvoiceMetadata(text).totalAmountTtc).toBeCloseTo(1234.56, 2);
  });

  it('extracts Total TTC in English decimal convention', () => {
    const text = 'Total TTC: 1,234.56';
    expect(extractInvoiceMetadata(text).totalAmountTtc).toBeCloseTo(1234.56, 2);
  });

  it('extracts Montant TTC label variant', () => {
    const text = 'Montant TTC: 250000';
    expect(extractInvoiceMetadata(text).totalAmountTtc).toBe(250000);
  });

  it('extracts TVA amount', () => {
    const text = 'TVA: 195,00\nTotal TTC: 1 195,00';
    const result = extractInvoiceMetadata(text);
    expect(result.tvaAmount).toBeCloseTo(195, 2);
  });

  it('extracts partner name from "De:" label', () => {
    const text = 'De: ACME Trading SARL\nFacture du 24/05/2026';
    expect(extractInvoiceMetadata(text).partnerName).toBe('ACME Trading SARL');
  });

  it('falls back to the first non-blank line for partner name', () => {
    const text = 'ACME Trading SARL\nFacture\n24/05/2026';
    expect(extractInvoiceMetadata(text).partnerName).toBe('ACME Trading SARL');
  });

  it('extracts invoice number from "Facture N°" pattern', () => {
    const text = 'Facture N° FAC-2026-001\nDate: 24/05/2026';
    expect(extractInvoiceMetadata(text).invoiceNumber).toBe('FAC-2026-001');
  });

  it('extracts invoice number from English "Invoice #" pattern', () => {
    const text = 'Invoice # INV-12345\nDate: 2026-05-24';
    expect(extractInvoiceMetadata(text).invoiceNumber).toBe('INV-12345');
  });

  it('handles a complete realistic French invoice', () => {
    const text = `
      ACME Trading SARL
      De: ACME Trading SARL
      Abidjan, Côte d'Ivoire

      FACTURE N° FAC-2026-001
      Date de facture: 24/05/2026

      Désignation         Qté    Prix unitaire    Total HT
      Service comptable   1      1 000,00         1 000,00

      Total HT:           1 000,00
      TVA (18%):            180,00
      Total TTC:          1 180,00 F CFA
    `;
    const result = extractInvoiceMetadata(text);
    expect(result.invoiceDate).toBe('2026-05-24');
    expect(result.totalAmountTtc).toBeCloseTo(1180, 2);
    expect(result.tvaAmount).toBeCloseTo(180, 2);
    expect(result.invoiceNumber).toBe('FAC-2026-001');
    expect(result.partnerName).toBe('ACME Trading SARL');
  });

  it('omits fields it cannot extract (no nulls in the output)', () => {
    const text = 'This is just some random text with no invoice fields.';
    const result = extractInvoiceMetadata(text);
    // None of the canonical fields should be present.
    expect(result.totalAmountTtc).toBeUndefined();
    expect(result.tvaAmount).toBeUndefined();
    expect(result.invoiceNumber).toBeUndefined();
    expect(result.invoiceDate).toBeUndefined();
  });
});
