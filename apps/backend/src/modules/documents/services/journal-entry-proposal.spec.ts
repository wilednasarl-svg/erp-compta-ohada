import type { ExtractedInvoice } from './invoice-extractor';
import { buildPurchaseEntryProposal } from './journal-entry-proposal';

function invoice(over: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    supplier: { name: 'LE JOINT IVOIRIEN' },
    customer: {},
    invoiceNumber: 'FAC-1',
    invoiceDate: '2025-11-28',
    totals: { totalHt: 690_000, totalVat: 124_200, totalTtc: 814_200 },
    lines: [{ designation: 'TIGE FORMATION T51' }],
    ...over,
  };
}

describe('buildPurchaseEntryProposal', () => {
  it('produces a balanced 3-line SYSCOHADA purchase entry', () => {
    const p = buildPurchaseEntryProposal(invoice());

    expect(p.journalCode).toBe('AC');
    expect(p.entryDate).toBe('2025-11-28');
    expect(p.reference).toBe('FAC-1');
    expect(p.balanced).toBe(true);
    expect(p.lines).toEqual([
      { accountCode: '601000', debit: 690_000, credit: 0, description: 'TIGE FORMATION T51' },
      { accountCode: '445200', debit: 124_200, credit: 0, description: 'TVA déductible' },
      { accountCode: '401000', debit: 0, credit: 814_200, description: 'LE JOINT IVOIRIEN' },
    ]);
  });

  it('always warns that the charge account must be confirmed', () => {
    const p = buildPurchaseEntryProposal(invoice());
    expect(p.warnings.some((w) => /charge .*confirmer/i.test(w))).toBe(true);
  });

  it('honours account / journal overrides', () => {
    const p = buildPurchaseEntryProposal(invoice(), {
      journalCode: 'ACH',
      chargeAccount: '602100',
      supplierAccount: '401LJI',
    });
    expect(p.journalCode).toBe('ACH');
    expect(p.lines[0].accountCode).toBe('602100');
    expect(p.lines[p.lines.length - 1].accountCode).toBe('401LJI');
  });

  it('derives the missing TTC from HT + VAT', () => {
    const p = buildPurchaseEntryProposal(invoice({ totals: { totalHt: 1000, totalVat: 180 } }));
    expect(p.lines[p.lines.length - 1]).toEqual({
      accountCode: '401000',
      debit: 0,
      credit: 1180,
      description: 'LE JOINT IVOIRIEN',
    });
    expect(p.balanced).toBe(true);
    expect(p.warnings.some((w) => /TTC déduit/i.test(w))).toBe(true);
  });

  it('omits the VAT line and flags imbalance when VAT is absent', () => {
    const p = buildPurchaseEntryProposal(invoice({ totals: { totalHt: 1000 } }));
    expect(p.lines.some((l) => l.accountCode === '445200')).toBe(false);
    // HT debit 1000 but no credit line → not balanced.
    expect(p.balanced).toBe(false);
  });
});
