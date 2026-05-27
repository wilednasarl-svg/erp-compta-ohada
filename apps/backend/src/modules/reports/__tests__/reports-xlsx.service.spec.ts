import * as XLSX from 'xlsx';

import { ReportsXlsxService } from '../services/reports-xlsx.service';
import type {
  BalanceSheetReport,
  BilanMasse,
  BilanPoste,
  ProfitLossReport,
  TftReport,
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
  totalCharges: '4500000.00',
  totalProduits: '8000000.00',
  resultat: '3500000.00',
});

const fakeTft = (): TftReport => ({
  fromDate: '2025-01-01',
  toDate: '2025-12-31',
  fluxExploitation: {
    code: 'ZA',
    label: 'Flux opérationnels',
    total: '3000000.00',
    lines: [{ code: 'FA', label: 'CAFG', amount: '3000000.00' }],
  },
  fluxInvestissement: {
    code: 'ZB',
    label: "Flux d'investissement",
    total: '-1500000.00',
    lines: [{ code: 'FF', label: "Acquisitions d'immo", amount: '-1500000.00' }],
  },
  fluxFinancement: {
    code: 'ZC',
    label: 'Flux de financement',
    total: '500000.00',
    lines: [{ code: 'FK', label: 'Augmentation de capital', amount: '500000.00' }],
  },
  variationTresorerie: '2000000.00',
  tresorerieOuverture: '1000000.00',
  tresorerieCloture: '3000000.00',
  methodologyNotes: [],
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
});

describe('ReportsXlsxService — CR W5.2 volet 2 (2 feuilles)', () => {
  let service: ReportsXlsxService;
  beforeEach(() => {
    service = new ReportsXlsxService();
  });

  it('produit un classeur à 2 feuilles : Compte de résultat + SIG', () => {
    const buf = service.profitLossXlsx(fakeProfitLoss(), 'ACME SARL');
    expect(buf.length).toBeGreaterThan(1024);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toHaveLength(2);
    expect(wb.SheetNames).toContain('Compte de résultat');
    expect(wb.SheetNames).toContain('SIG');
  });

  it('feuille SIG contient les 9 codes XA → XI avec leurs formules', () => {
    const buf = service.profitLossXlsx(fakeProfitLoss(), 'ACME SARL');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sig = wb.Sheets['SIG'];
    const joined = sheetStrings(sig).join('||');
    for (const code of ['XA', 'XB', 'XC', 'XD', 'XE', 'XF', 'XG', 'XH', 'XI']) {
      expect(joined).toContain(code);
    }
    // Au moins une formule doctrinale (XA = TA + RA + RB).
    expect(joined).toMatch(/XA\s*=\s*TA/);
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

  it('contient les 3 sections ZA / ZB / ZC + pied ZD / ZG / ZH', () => {
    const buf = service.tftXlsx(fakeTft(), 'ACME SARL');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const joined = sheetStrings(sheet).join('||');
    for (const code of ['ZA', 'ZB', 'ZC', 'ZD', 'ZG', 'ZH']) {
      expect(joined).toContain(code);
    }
  });
});
