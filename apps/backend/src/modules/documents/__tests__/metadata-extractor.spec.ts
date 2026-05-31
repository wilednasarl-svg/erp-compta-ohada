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

  it('extracts Total HT (pre-tax) from a labelled row', () => {
    expect(extractInvoiceMetadata('Total HT: 1 000,00').totalAmountHt).toBeCloseTo(1000, 2);
    expect(extractInvoiceMetadata('Montant HT : 500,00').totalAmountHt).toBe(500);
    expect(extractInvoiceMetadata('Base HT 2 500,50 XOF').totalAmountHt).toBe(2500.5);
  });

  it('parses PaddleOCR-VL Markdown-table rows (pipe-delimited cells)', () => {
    const markdown = [
      '| Désignation | Montant |',
      '| --- | --- |',
      '| Total HT | 1 000 000,00 |',
      '| Total TVA (18%) | 180 000,00 |',
      '| Total TTC | 1 180 000,00 |',
    ].join('\n');
    const result = extractInvoiceMetadata(markdown);
    expect(result.totalAmountHt).toBe(1_000_000);
    expect(result.tvaAmount).toBe(180_000);
    expect(result.totalAmountTtc).toBe(1_180_000);
  });

  it('skips a parenthetical rate so "Total TVA (18%)" yields the amount, not 18', () => {
    expect(extractInvoiceMetadata('Total TVA (18%): 180 000,00').tvaAmount).toBe(180_000);
  });

  it('omits totalAmountHt when no HT label is present', () => {
    expect(extractInvoiceMetadata('Total TTC: 1 180,00').totalAmountHt).toBeUndefined();
  });

  it('parses a real PaddleOCR-VL HTML invoice (LE JOINT IVOIRIEN / GRAVEL IVOIRE)', () => {
    // Trimmed but faithful slice of the actual `parse_doc` output: HTML
    // tables, a parenthetical VAT rate on the line item ("TVA (18)"),
    // a zero in the Rem.(%) cell, and "FACTURE NORMALISÉE" (which used
    // to false-match "No" inside the word).
    const html = `LE JOINT IVOIRIEN
NCC : 8203222L
N°Facture ERP : FAFA75331 - N°BL : BLBL67390
Facture de vente N° 8203222L25000002014
FACTURE NORMALISÉE ÉLECTRONIQUE
Date et heure : 28/11/2025 16:38:16
<table><tr><td>Réf</td><td>Désignation</td><td>P.U HT</td><td>Qté</td><td>Taxes (%)</td><td>Rem. (%)</td><td>Montant HT</td></tr><tr><td>XZ26000TC51</td><td>TIGE FORMATION T51</td><td>345 000</td><td>2</td><td>TVA (18)</td><td>0</td><td>690 000</td></tr><tr><td colspan="5">TOTAL HT</td><td>690 000</td></tr><tr><td colspan="5">TVA</td><td>124 200</td></tr><tr><td colspan="5">TOTAL TTC</td><td>814 200</td></tr><tr><td colspan="5">TOTAL A PAYER</td><td>814 200</td></tr></table>`;

    const r = extractInvoiceMetadata(html);

    expect(r.partnerName).toBe('LE JOINT IVOIRIEN');
    expect(r.invoiceDate).toBe('2025-11-28');
    expect(r.totalAmountHt).toBe(690_000);
    expect(r.tvaAmount).toBe(124_200); // the totals row, NOT the line-item "TVA (18)" → 0
    expect(r.totalAmountTtc).toBe(814_200);
    expect(r.invoiceNumber).toBe('8203222L25000002014'); // digit rule skips "RMALIS"/"Facture"
  });

  it('takes the largest amount when a label repeats (line item vs totals)', () => {
    // "TVA (18)" line-item with a 0 cell, then the real "TVA" total.
    const text = 'TVA (18) | 0 | 690 000\nTVA | 124 200';
    expect(extractInvoiceMetadata(text).tvaAmount).toBe(124_200);
  });

  it('rejects invoice-number false positives lacking a digit', () => {
    // "FACTURE NORMALISÉE" must not yield "RMALIS" via the "No" keyword.
    expect(extractInvoiceMetadata('FACTURE NORMALISÉE ÉLECTRONIQUE').invoiceNumber).toBeUndefined();
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
