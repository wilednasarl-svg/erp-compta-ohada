import { extractInvoice } from './invoice-extractor';

/**
 * Faithful (trimmed) slice of the real PaddleOCR-VL `parse_doc` output for
 * an Ivorian FNE invoice (LE JOINT IVOIRIEN → GRAVEL IVOIRE).
 */
const REAL_INVOICE = `LE JOINT IVOIRIEN
NCC : 8203222L
Régime d'imposition : RNI
Centre des impôts : 822 Recette des Grandes Entreprises
Établissement : LE JOINT IVOIRIEN
Adresse : 18 BP 1315 ABIDJAN 18
N° Tel : 2721599565
Nom du vendeur :
Nom de PDV : SIEGE
Date et heure : 28/11/2025 16:38:16
Mode de paiement : A terme
N°Facture ERP : FAFA75331 - N°BL : BLBL67390
Facture de vente N° 8203222L25000002014
Client
Nom : GRAVEL IVOIRE
Adresse : info@info.ci
NCC : 1813727J
Régime d'imposition : RNI
<table border=1><tr><td>Réf</td><td>Désignation</td><td>P.U HT</td><td>Qté</td><td>Unité</td><td>Taxes (%)</td><td>Rem. (%)</td><td>Montant HT</td></tr><tr><td>XZ26000TC51</td><td>TIGE FORMATION T51 MF 3.6</td><td>345 000</td><td>2</td><td>UNITE</td><td>TVA (18)</td><td>0</td><td>690 000</td></tr><tr><td rowspan="5" colspan="2"></td><td colspan="5">TOTAL HT</td><td>690 000</td></tr><tr><td colspan="5">TVA</td><td>124 200</td></tr><tr><td colspan="5">TOTAL TTC</td><td>814 200</td></tr><tr><td colspan="5">AUTRES TAXES</td><td>0</td></tr><tr><td colspan="5">TOTAL A PAYER</td><td>814 200</td></tr></table>`;

describe('extractInvoice', () => {
  it('returns empty structures for blank input', () => {
    const r = extractInvoice('');
    expect(r.supplier).toEqual({});
    expect(r.customer).toEqual({});
    expect(r.lines).toEqual([]);
    expect(r.totals).toEqual({});
  });

  it('extracts the full supplier header', () => {
    const r = extractInvoice(REAL_INVOICE);
    expect(r.supplier.name).toBe('LE JOINT IVOIRIEN');
    expect(r.supplier.ncc).toBe('8203222L');
    expect(r.supplier.taxRegime).toBe('RNI');
    expect(r.supplier.taxCenter).toMatch(/Recette des Grandes Entreprises/);
    expect(r.supplier.address).toMatch(/ABIDJAN/);
    expect(r.supplier.phone).toBe('2721599565');
  });

  it('extracts the customer block (NCC distinct from supplier)', () => {
    const r = extractInvoice(REAL_INVOICE);
    expect(r.customer.name).toBe('GRAVEL IVOIRE');
    expect(r.customer.ncc).toBe('1813727J');
  });

  it('extracts references, date and payment mode', () => {
    const r = extractInvoice(REAL_INVOICE);
    expect(r.invoiceNumber).toBe('8203222L25000002014');
    expect(r.erpInvoiceNumber).toBe('FAFA75331');
    expect(r.deliveryNote).toBe('BLBL67390');
    expect(r.invoiceDate).toBe('2025-11-28');
    expect(r.paymentMode).toMatch(/terme/i);
    expect(r.pointOfSale).toBe('SIEGE');
  });

  it('does not let an empty "Nom du vendeur" bleed into the next line', () => {
    expect(extractInvoice(REAL_INVOICE).sellerName).toBeUndefined();
  });

  it('extracts totals (TVA from the totals row, not the line-item rate)', () => {
    const r = extractInvoice(REAL_INVOICE);
    expect(r.totals.totalHt).toBe(690_000);
    expect(r.totals.totalVat).toBe(124_200);
    expect(r.totals.totalTtc).toBe(814_200);
    expect(r.totals.totalToPay).toBe(814_200);
  });

  it('extracts the line item with its columns mapped', () => {
    const r = extractInvoice(REAL_INVOICE);
    expect(r.lines).toHaveLength(1);
    const line = r.lines[0];
    expect(line.ref).toBe('XZ26000TC51');
    expect(line.designation).toMatch(/TIGE FORMATION/);
    expect(line.unitPriceHt).toBe(345_000);
    expect(line.quantity).toBe(2);
    expect(line.amountHt).toBe(690_000);
    expect(line.vatRatePct).toBe(18);
  });
});
