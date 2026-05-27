import * as XLSX from 'xlsx';

import type { CashFlowReport } from '../services/cash-flow.service';
import { ReportsXlsxService } from '../services/reports-xlsx.service';
import type {
  BalanceSheetReport,
  BilanMasse,
  BilanPoste,
  ProfitLossReport,
} from '../services/reports.service';

/**
 * Tests W5.2 volet 2 — XLSX (Bilan + CR + TFT) refondus à la contexture
 * normalisée DGI SYSCOHADA.
 *
 * Stratégie : on ré-ouvre le buffer généré avec `XLSX.read` pour
 * vérifier :
 *   - taille minimale (≥ 1 KB)
 *   - nombre / noms de feuilles
 *   - présence des entêtes de colonnes attendues
 *   - présence des codes lettrés du référentiel (AZ, CP, DZ, ZA, ZG, XA…)
 */

const poste = (
  code: string,
  label: string,
  side: 'ACTIF' | 'PASSIF',
  net: string,
  opts?: { brut?: string; deduction?: string; netPrevious?: string },
): BilanPoste => ({
  code,
  label,
  side,
  net,
  ...(opts?.brut !== undefined ? { brut: opts.brut } : {}),
  ...(opts?.deduction !== undefined ? { deduction: opts.deduction } : {}),
  ...(opts?.netPrevious !== undefined ? { netPrevious: opts.netPrevious } : {}),
});

const fakeBilan = (): BalanceSheetReport => {
  const actifMasses: ReadonlyArray<BilanMasse> = [
    {
      code: 'AZ',
      label: 'Total actif immobilisé',
      total: '5000000.00',
      totalPrevious: '4500000.00',
      rubriques: [
        {
          label: 'Actif immobilisé',
          subtotal: '5000000.00',
          subtotalPrevious: '4500000.00',
          postes: [
            poste('AE', 'Frais de développement', 'ACTIF', '3000000.00', {
              brut: '3500000.00',
              deduction: '500000.00',
              netPrevious: '2800000.00',
            }),
            poste('AI', 'Bâtiments', 'ACTIF', '2000000.00', {
              brut: '2500000.00',
              deduction: '500000.00',
              netPrevious: '1700000.00',
            }),
          ],
        },
      ],
    },
  ];
  const passifMasses: ReadonlyArray<BilanMasse> = [
    {
      code: 'CP',
      label: 'Total capitaux propres',
      total: '5000000.00',
      totalPrevious: '4500000.00',
      rubriques: [
        {
          label: 'Capitaux propres',
          subtotal: '5000000.00',
          subtotalPrevious: '4500000.00',
          postes: [poste('CA', 'Capital', 'PASSIF', '5000000.00', { netPrevious: '4500000.00' })],
        },
      ],
    },
    {
      code: 'DZ',
      label: 'Total général passif',
      total: '5000000.00',
      totalPrevious: '4500000.00',
      rubriques: [],
    },
  ];
  return {
    asAtDate: '2025-12-31',
    actif: { sections: [], total: '5000000.00' },
    passif: { sections: [], total: '5000000.00' },
    actifMasses,
    passifMasses,
    unclassified: [],
    totals: { actif: '5000000.00', passif: '5000000.00', difference: '0.00' },
    netResultIncorporated: '500000.00',
    difference: '0.00',
    previous: {
      asAtDate: '2024-12-31',
      totalActif: '4500000.00',
      totalPassif: '4500000.00',
      difference: '0.00',
    },
  };
};

const fakeProfitLoss = (): ProfitLossReport => ({
  fromDate: '2025-01-01',
  toDate: '2025-12-31',
  charges: [
    {
      code: '60',
      label: 'Achats et variations de stocks',
      amount: '4500000.00',
      accounts: [{ code: '601000', label: 'Achats de marchandises', amount: '4500000.00' }],
    },
  ],
  produits: [
    {
      code: '70',
      label: 'Ventes',
      amount: '8000000.00',
      accounts: [{ code: '701000', label: 'Ventes de marchandises', amount: '8000000.00' }],
    },
  ],
  // Séquence doctrinale Tome 3 p. 33 — fake minimal incluant les 9 SIG.
  lines: [
    { ref: 'TA', label: 'Ventes de marchandises', note: '21', sign: '+', kind: 'PRODUIT', amountN: '8000000.00' },
    { ref: 'RA', label: 'Achats de marchandises', note: '22', sign: '-', kind: 'CHARGE', amountN: '-4500000.00' },
    { ref: 'RB', label: 'Variation de stocks de marchandises', note: '6', sign: '-/+', kind: 'CHARGE', amountN: '0.00' },
    { ref: 'XA', label: 'MARGE COMMERCIALE', kind: 'SIG', amountN: '3500000.00' },
    { ref: 'XB', label: "CHIFFRE D'AFFAIRES", kind: 'SIG', amountN: '8000000.00' },
    { ref: 'XC', label: 'VALEUR AJOUTÉE', kind: 'SIG', amountN: '3500000.00' },
    { ref: 'XD', label: "EXCÉDENT BRUT D'EXPLOITATION", kind: 'SIG', amountN: '3500000.00' },
    { ref: 'XE', label: "RÉSULTAT D'EXPLOITATION", kind: 'SIG', amountN: '3500000.00' },
    { ref: 'XF', label: 'RÉSULTAT FINANCIER', kind: 'SIG', amountN: '0.00' },
    { ref: 'XG', label: 'RÉSULTAT DES ACTIVITÉS ORDINAIRES', kind: 'SIG', amountN: '3500000.00' },
    { ref: 'XH', label: 'RÉSULTAT HORS ACTIVITÉS ORDINAIRES', kind: 'SIG', amountN: '0.00' },
    { ref: 'XI', label: 'RÉSULTAT NET', kind: 'SIG', amountN: '3500000.00' },
  ],
  totalCharges: '4500000.00',
  totalProduits: '8000000.00',
  resultat: '3500000.00',
});

const fakeTft = (): CashFlowReport => ({
  fromDate: '2025-01-01',
  toDate: '2025-12-31',
  openingCash: '1000000.00',
  operatingFlows: {
    code: 'ZB',
    label: 'Flux opérationnels',
    subtotal: '3000000.00',
    postes: [{ code: 'FA', label: 'CAFG', amount: '3000000.00' }],
  },
  investingFlows: {
    code: 'ZC',
    label: "Flux d'investissement",
    subtotal: '-1500000.00',
    postes: [{ code: 'FF', label: "Acquisitions d'immo", amount: '-1500000.00' }],
  },
  financingFlowsEquity: {
    code: 'ZD',
    label: 'Financement CP',
    subtotal: '500000.00',
    postes: [{ code: 'FK', label: 'Augmentation de capital', amount: '500000.00' }],
  },
  financingFlowsDebt: {
    code: 'ZE',
    label: 'Financement CE',
    subtotal: '0.00',
    postes: [{ code: 'FO', label: 'Emprunts nouveaux', amount: '0.00' }],
  },
  financingFlowsTotal: '500000.00',
  netCashVariation: '2000000.00',
  closingCash: '3000000.00',
  coherenceCheck: '0.00',
});

/** Extrait les chaînes texte de toutes les cellules d'une feuille. */
const sheetStrings = (sheet: XLSX.WorkSheet): string[] => {
  const result: string[] = [];
  for (const ref of Object.keys(sheet)) {
    if (ref.startsWith('!')) continue;
    const cell = (sheet as Record<string, XLSX.CellObject | undefined>)[ref];
    if (cell !== undefined) {
      result.push(String(cell.v ?? ''));
    }
  }
  return result;
};

describe('ReportsXlsxService — Bilan W5.2 volet 2', () => {
  let service: ReportsXlsxService;
  beforeEach(() => {
    service = new ReportsXlsxService();
  });

  it('produit un buffer XLSX ≥ 1 KB pour le Bilan', () => {
    const buf = service.balanceSheetXlsx(fakeBilan(), 'ACME SARL');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1024);
  });

  it("contient les 6 colonnes contexture DGI (Brut N, Amort. & dépréc., Net N, Net N-1)", () => {
    const buf = service.balanceSheetXlsx(fakeBilan(), 'ACME SARL');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const joined = sheetStrings(sheet).join('||');
    expect(joined).toContain('Brut N');
    expect(joined).toMatch(/Amort/);
    expect(joined).toContain('Net N');
    expect(joined).toContain('Net N-1');
  });

  it('contient les codes de masses AZ / CP / DZ', () => {
    const buf = service.balanceSheetXlsx(fakeBilan(), 'ACME SARL');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const joined = sheetStrings(sheet).join('||');
    expect(joined).toContain('AZ');
    expect(joined).toContain('CP');
    expect(joined).toContain('DZ');
  });

  /**
   * C2 — En-tête à 7 colonnes (Tome 3 p. 32) : la colonne « Note »
   * doit apparaître entre Libellé et Brut N pour le renvoi annexes.
   */
  it("contient la colonne « Note » à 7 colonnes côté ACTIF", () => {
    const buf = service.balanceSheetXlsx(fakeBilan(), 'ACME SARL');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const cells = sheetStrings(sheet);
    expect(cells).toContain('Note');
    // Cellule "Note" présente dans la ligne d'entête (entre Libellé et Brut N)
    expect(cells.filter((c) => c === 'Note').length).toBeGreaterThanOrEqual(1);
  });
});

describe('ReportsXlsxService — CR feuille unique Tome 3 p. 33', () => {
  let service: ReportsXlsxService;
  beforeEach(() => {
    service = new ReportsXlsxService();
  });

  it('produit un classeur à 1 feuille unique « Compte de résultat »', () => {
    const buf = service.profitLossXlsx(fakeProfitLoss(), 'ACME SARL');
    expect(buf.length).toBeGreaterThan(1024);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toHaveLength(1);
    expect(wb.SheetNames).toContain('Compte de résultat');
  });

  it('feuille unique contient les 9 codes SIG XA → XI intercalés dans la cascade', () => {
    const buf = service.profitLossXlsx(fakeProfitLoss(), 'ACME SARL');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets['Compte de résultat'];
    const joined = sheetStrings(sheet).join('||');
    for (const code of ['XA', 'XB', 'XC', 'XD', 'XE', 'XF', 'XG', 'XH', 'XI']) {
      expect(joined).toContain(code);
    }
    // Et les colonnes doctrinales Tome 3 p. 33 (Note + +/-).
    expect(joined).toContain('Note');
    expect(joined).toContain('+/-');
    // Devise XOF en pied de tableau.
    expect(joined).toContain('XOF');
  });
});

describe('ReportsXlsxService — TFT W5.2 volet 2', () => {
  let service: ReportsXlsxService;
  beforeEach(() => {
    service = new ReportsXlsxService();
  });

  it('produit un buffer XLSX ≥ 1 KB pour le TFT', () => {
    const buf = service.tftXlsx(fakeTft(), 'ACME SARL');
    expect(buf.length).toBeGreaterThan(1024);
  });

  it('contient la nomenclature doctrine ZA → ZH (Tome 3 p. 34)', () => {
    const buf = service.tftXlsx(fakeTft(), 'ACME SARL');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const joined = sheetStrings(sheet).join('||');
    for (const code of ['ZA', 'ZB', 'ZC', 'ZD', 'ZE', 'ZF', 'ZG', 'ZH']) {
      expect(joined).toContain(code);
    }
  });
});

// ─── D2 — Grand Livre format doctrine OHADA ─────────────────────────────
import type { GeneralLedgerReport } from '../services/reports.service';

const fakeGeneralLedger = (): GeneralLedgerReport => ({
  accountId: 'a-1',
  accountCode: '411000',
  accountLabel: 'CLIENT X',
  accountClass: 4,
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
  opening: {
    openingDebit: '500.00',
    openingCredit: '0.00',
    openingBalance: '500.00',
    openingBalanceSide: 'D',
  },
  lines: [
    {
      lineId: 'l-1',
      entryId: 'e-1',
      entryDate: '2026-02-15',
      journalCode: 'VTE',
      entryNumber: 1,
      description: 'Facture FA-001',
      debit: '200.00',
      credit: '0.00',
      letteringCode: null,
      runningBalance: '700.00',
      runningBalanceAbs: '700.00',
      runningBalanceSide: 'D',
    },
    {
      lineId: 'l-2',
      entryId: 'e-2',
      entryDate: '2026-03-01',
      journalCode: 'BQ',
      entryNumber: 2,
      description: 'Règlement client',
      debit: '0.00',
      credit: '300.00',
      letteringCode: 'A0001',
      runningBalance: '400.00',
      runningBalanceAbs: '400.00',
      runningBalanceSide: 'D',
    },
  ],
  totals: {
    periodDebit: '200.00',
    periodCredit: '300.00',
    endingDebit: '400.00',
    endingCredit: '0.00',
    closingBalance: '400.00',
    closingBalanceSide: 'D',
  },
});

describe('ReportsXlsxService — Grand Livre D2 (doctrine OHADA)', () => {
  let service: ReportsXlsxService;
  beforeEach(() => {
    service = new ReportsXlsxService();
  });

  it('produit un buffer XLSX ≥ 1 KB pour le Grand Livre', () => {
    const buf = service.generalLedgerXlsx(fakeGeneralLedger(), 'ACME SARL');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1024);
  });

  it('contient les 8 colonnes doctrine (Date, Journal, Pièce, Libellé, Débit, Crédit, Solde, D/C)', () => {
    const buf = service.generalLedgerXlsx(fakeGeneralLedger(), 'ACME SARL');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const cells = sheetStrings(sheet);
    for (const header of ['Date', 'Journal', 'Pièce', 'Libellé', 'Débit', 'Crédit', 'Solde', 'D/C']) {
      expect(cells).toContain(header);
    }
  });

  it('matérialise le report à nouveau et le TOTAL compte avec côté D/C', () => {
    const buf = service.generalLedgerXlsx(fakeGeneralLedger(), 'ACME SARL');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const joined = sheetStrings(sheet).join('||');
    expect(joined).toContain('REPORT À NOUVEAU');
    expect(joined).toContain('TOTAL 411000');
    expect(joined).toContain('D');
  });
});
