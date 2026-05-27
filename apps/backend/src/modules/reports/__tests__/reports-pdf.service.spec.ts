import PDFDocument from 'pdfkit';

import type { CashFlowReport } from '../services/cash-flow.service';
import { ReportsPdfService } from '../services/reports-pdf.service';
import type {
  BalanceSheetReport,
  BilanMasse,
  BilanPoste,
  ProfitLossReport,
} from '../services/reports.service';

/**
 * Tests W5.2 — Bilan PDF contexture normalisée DGI à 4 colonnes
 * (Brut N | Amort. & dépréc. | Net N | Net N-1).
 *
 * Stratégie de vérification : on n'analyse pas le PDF binaire (les
 * streams sont compressés FlateDecode → grep impossible). À la place :
 *  - vérifier que `balanceSheetPdf` retourne un Buffer PDF valide (header %PDF-)
 *  - capturer TOUS les `doc.text(...)` appels via un spy sur le proto de
 *    PDFDocument pour vérifier la présence des libellés de colonnes,
 *    des codes de masses et de la devise XOF.
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

const fakeReport = (): BalanceSheetReport => {
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
    {
      code: 'BJ',
      label: 'Total actif circulant',
      total: '1500000.00',
      totalPrevious: '1200000.00',
      rubriques: [
        {
          label: 'Actif circulant',
          subtotal: '1500000.00',
          subtotalPrevious: '1200000.00',
          postes: [
            poste('BB', 'Stocks de marchandises', 'ACTIF', '1500000.00', {
              brut: '1600000.00',
              deduction: '100000.00',
              netPrevious: '1200000.00',
            }),
          ],
        },
      ],
    },
    {
      code: 'BT',
      label: 'Total général actif',
      total: '6500000.00',
      totalPrevious: '5700000.00',
      rubriques: [],
    },
  ];

  const passifMasses: ReadonlyArray<BilanMasse> = [
    {
      code: 'CP',
      label: 'Total capitaux propres',
      total: '3500000.00',
      totalPrevious: '3000000.00',
      rubriques: [
        {
          label: 'Capitaux propres',
          subtotal: '3500000.00',
          subtotalPrevious: '3000000.00',
          postes: [
            poste('CA', 'Capital', 'PASSIF', '3000000.00', {
              netPrevious: '2700000.00',
            }),
            poste('CJ', 'Résultat net', 'PASSIF', '500000.00', {
              netPrevious: '300000.00',
            }),
          ],
        },
      ],
    },
    {
      code: 'DZ',
      label: 'Total général passif',
      total: '6500000.00',
      totalPrevious: '5700000.00',
      rubriques: [],
    },
  ];

  return {
    asAtDate: '2025-12-31',
    actif: { sections: [], total: '6500000.00' },
    passif: { sections: [], total: '6500000.00' },
    actifMasses,
    passifMasses,
    unclassified: [],
    totals: {
      actif: '6500000.00',
      passif: '6500000.00',
      difference: '0.00',
    },
    netResultIncorporated: '500000.00',
    difference: '0.00',
    previous: {
      asAtDate: '2024-12-31',
      totalActif: '5700000.00',
      totalPassif: '5700000.00',
      difference: '0.00',
    },
  };
};

/**
 * Capture chaque chaîne passée à `doc.text(...)` en patchant le proto
 * `PDFDocument.prototype.text`. Restauration garantie via afterEach.
 */
const captureTextCalls = (): { calls: string[]; restore: () => void } => {
  const calls: string[] = [];
  const proto = PDFDocument.prototype as unknown as {
    text: (...args: unknown[]) => unknown;
  };
  const original = proto.text;
  proto.text = function patched(...args: unknown[]): unknown {
    if (typeof args[0] === 'string') {
      calls.push(args[0]);
    } else if (typeof args[0] === 'number') {
      calls.push(String(args[0]));
    }
    return original.apply(this, args);
  };
  return {
    calls,
    restore: () => {
      proto.text = original;
    },
  };
};

describe('ReportsPdfService — Bilan W5.2', () => {
  let service: ReportsPdfService;

  beforeEach(() => {
    service = new ReportsPdfService();
  });

  it('produit un buffer PDF non vide pour le Bilan', async () => {
    const buf = await service.balanceSheetPdf(fakeReport(), 'ACME SARL');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('contient les 4 entêtes de colonnes DGI normalisées', async () => {
    const cap = captureTextCalls();
    try {
      await service.balanceSheetPdf(fakeReport(), 'ACME SARL');
    } finally {
      cap.restore();
    }
    const joined = cap.calls.join('||');
    expect(joined).toContain('Brut N');
    // « Amort. & dépréc. » — vérifie le radical (les colonnes peuvent
    // être abrégées sur certaines configurations).
    expect(joined).toMatch(/Amort/);
    expect(joined).toContain('Net N');
    expect(joined).toContain('Net N-1');
  });

  it('contient les codes de masses lettrés du référentiel SYSCOHADA', async () => {
    const cap = captureTextCalls();
    try {
      await service.balanceSheetPdf(fakeReport(), 'ACME SARL');
    } finally {
      cap.restore();
    }
    const joined = cap.calls.join('||');
    expect(joined).toContain('AZ');
    expect(joined).toContain('BJ');
    expect(joined).toContain('BT');
    expect(joined).toContain('CP');
    expect(joined).toContain('DZ');
  });

  it('indique la devise XOF dans le sous-titre', async () => {
    const cap = captureTextCalls();
    try {
      await service.balanceSheetPdf(fakeReport(), 'ACME SARL');
    } finally {
      cap.restore();
    }
    expect(cap.calls.join('||')).toContain('XOF');
  });
});

/* ========================================================================== */
/* W5.2 volet 2 — CR PDF + TFT PDF (contexture normalisée DGI)               */
/* ========================================================================== */

const fakeProfitLoss = (): ProfitLossReport => ({
  fromDate: '2025-01-01',
  toDate: '2025-12-31',
  charges: [
    {
      code: '60',
      label: 'Achats et variations de stocks',
      amount: '4500000.00',
      accounts: [
        { code: '601000', label: 'Achats de marchandises', amount: '3000000.00' },
        { code: '602000', label: 'Achats de matières premières', amount: '1500000.00' },
      ],
    },
    {
      code: '66',
      label: 'Charges de personnel',
      amount: '2000000.00',
      accounts: [{ code: '661000', label: 'Salaires bruts', amount: '2000000.00' }],
    },
  ],
  produits: [
    {
      code: '70',
      label: 'Ventes',
      amount: '8000000.00',
      accounts: [
        { code: '701000', label: 'Ventes de marchandises', amount: '5000000.00' },
        { code: '702000', label: 'Ventes de produits fabriqués', amount: '3000000.00' },
      ],
    },
    {
      code: '77',
      label: 'Revenus financiers et assimilés',
      amount: '500000.00',
      accounts: [{ code: '771000', label: 'Intérêts perçus', amount: '500000.00' }],
    },
  ],
  // Séquence doctrinale Tome 3 p. 33 — fake minimal mais incluant les
  // 9 SIG (XA..XI) intercalés. Les montants sont arbitraires (suffisants
  // pour vérifier que le PDF rend bien chaque code).
  lines: [
    { ref: 'TA', label: 'Ventes de marchandises', note: '21', sign: '+', kind: 'PRODUIT', amountN: '5000000.00' },
    { ref: 'RA', label: 'Achats de marchandises', note: '22', sign: '-', kind: 'CHARGE', amountN: '-3000000.00' },
    { ref: 'RB', label: 'Variation de stocks de marchandises', note: '6', sign: '-/+', kind: 'CHARGE', amountN: '0.00' },
    { ref: 'XA', label: 'MARGE COMMERCIALE', kind: 'SIG', amountN: '2000000.00' },
    { ref: 'TB', label: 'Ventes de produits fabriqués', note: '21', sign: '+', kind: 'PRODUIT', amountN: '3000000.00' },
    { ref: 'TC', label: 'Travaux, services vendus', note: '21', sign: '+', kind: 'PRODUIT', amountN: '0.00' },
    { ref: 'TD', label: 'Produits accessoires', note: '21', sign: '+', kind: 'PRODUIT', amountN: '0.00' },
    { ref: 'XB', label: "CHIFFRE D'AFFAIRES", kind: 'SIG', amountN: '8000000.00' },
    { ref: 'XC', label: 'VALEUR AJOUTÉE', kind: 'SIG', amountN: '4500000.00' },
    { ref: 'RK', label: 'Charges de personnel', note: '27', sign: '-', kind: 'CHARGE', amountN: '-2000000.00' },
    { ref: 'XD', label: "EXCÉDENT BRUT D'EXPLOITATION", kind: 'SIG', amountN: '2500000.00' },
    { ref: 'XE', label: "RÉSULTAT D'EXPLOITATION", kind: 'SIG', amountN: '2500000.00' },
    { ref: 'TK', label: 'Revenus financiers et assimilés', note: '29', sign: '+', kind: 'PRODUIT', amountN: '500000.00' },
    { ref: 'XF', label: 'RÉSULTAT FINANCIER', kind: 'SIG', amountN: '500000.00' },
    { ref: 'XG', label: 'RÉSULTAT DES ACTIVITÉS ORDINAIRES', kind: 'SIG', amountN: '3000000.00' },
    { ref: 'XH', label: 'RÉSULTAT HORS ACTIVITÉS ORDINAIRES', kind: 'SIG', amountN: '0.00' },
    { ref: 'RS', label: 'Impôts sur le résultat', sign: '-', kind: 'CHARGE', amountN: '-1000000.00' },
    { ref: 'XI', label: 'RÉSULTAT NET', kind: 'SIG', amountN: '2000000.00' },
  ],
  totalCharges: '6500000.00',
  totalProduits: '8500000.00',
  resultat: '2000000.00',
});

const fakeTft = (): CashFlowReport => ({
  fromDate: '2025-01-01',
  toDate: '2025-12-31',
  openingCash: '1000000.00',
  operatingFlows: {
    code: 'ZB',
    label: 'Flux de trésorerie provenant des activités opérationnelles',
    subtotal: '3000000.00',
    postes: [
      { code: 'FA', label: 'CAFG', amount: '2500000.00' },
      { code: 'FB', label: "Variation actif circulant HAO", amount: '0.00' },
      { code: 'FC', label: 'Variation stocks', amount: '0.00' },
      { code: 'FD', label: 'Variation créances', amount: '500000.00' },
      { code: 'FE', label: 'Variation passif circulant', amount: '0.00' },
    ],
  },
  investingFlows: {
    code: 'ZC',
    label: "Flux de trésorerie provenant des opérations d'investissement",
    subtotal: '-1500000.00',
    postes: [
      { code: 'FF', label: "Acquisitions d'immobilisations", amount: '-2000000.00' },
      { code: 'FG', label: 'Acquisitions immo. financières', amount: '0.00' },
      { code: 'FH', label: "Cessions d'immobilisations", amount: '500000.00' },
      { code: 'FI', label: 'Cessions immo. financières', amount: '0.00' },
      { code: 'FJ', label: 'Variation créances cessions', amount: '0.00' },
    ],
  },
  financingFlowsEquity: {
    code: 'ZD',
    label: 'Flux de trésorerie provenant des capitaux propres',
    subtotal: '500000.00',
    postes: [
      { code: 'FK', label: 'Augmentation de capital', amount: '500000.00' },
      { code: 'FL', label: 'Subventions investissement', amount: '0.00' },
      { code: 'FM', label: 'Prélèvements capital', amount: '0.00' },
      { code: 'FN', label: 'Dividendes versés', amount: '0.00' },
    ],
  },
  financingFlowsDebt: {
    code: 'ZE',
    label: 'Flux de trésorerie provenant des capitaux étrangers',
    subtotal: '0.00',
    postes: [
      { code: 'FO', label: 'Emprunts nouveaux', amount: '0.00' },
      { code: 'FP', label: 'Autres dettes financières', amount: '0.00' },
      { code: 'FQ', label: 'Remboursements emprunts', amount: '0.00' },
    ],
  },
  financingFlowsTotal: '500000.00',
  netCashVariation: '2000000.00',
  closingCash: '3000000.00',
  coherenceCheck: '0.00',
});

describe('ReportsPdfService — Compte de Résultat W5.2 volet 2', () => {
  let service: ReportsPdfService;

  beforeEach(() => {
    service = new ReportsPdfService();
  });

  it('produit un buffer PDF non vide pour le CR', async () => {
    const buf = await service.profitLossPdf(fakeProfitLoss(), 'ACME SARL');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('contient les 9 codes SIG (XA à XI) dans la cascade', async () => {
    const cap = captureTextCalls();
    try {
      await service.profitLossPdf(fakeProfitLoss(), 'ACME SARL');
    } finally {
      cap.restore();
    }
    const joined = cap.calls.join('||');
    for (const code of ['XA', 'XB', 'XC', 'XD', 'XE', 'XF', 'XG', 'XH', 'XI']) {
      expect(joined).toContain(code);
    }
  });

  it("contient la section « ACTIVITÉS ORDINAIRES » + intercale les SIG XA..XI en cascade", async () => {
    const cap = captureTextCalls();
    try {
      await service.profitLossPdf(fakeProfitLoss(), 'ACME SARL');
    } finally {
      cap.restore();
    }
    const joined = cap.calls.join('||');
    expect(joined).toContain('ACTIVITÉS ORDINAIRES');
    // Tome 3 p. 33 : les SIG sont intercalés (pas dans un encadré
    // séparé). On vérifie l'ordre éditorial XA → XB → XC dans le flux.
    expect(joined.indexOf('XA')).toBeLessThan(joined.indexOf('XB'));
    expect(joined.indexOf('XB')).toBeLessThan(joined.indexOf('XC'));
    expect(joined).toContain('XOF');
  });

  it("intercale les SIG entre les postes lettrés (XA après TA/RA/RB, pas en encadré séparé)", async () => {
    const cap = captureTextCalls();
    try {
      await service.profitLossPdf(fakeProfitLoss(), 'ACME SARL');
    } finally {
      cap.restore();
    }
    const joined = cap.calls.join('||');
    // L'ordre doctrinal Tome 3 p. 33 : TA → RA → RB → **XA** → TB
    expect(joined.indexOf('TA')).toBeLessThan(joined.indexOf('XA'));
    expect(joined.indexOf('XA')).toBeLessThan(joined.indexOf('TB'));
    // La colonne « +/- » est rendue (signe doctrinal).
    expect(joined).toContain('+/-');
    // La colonne « Note » expose les renvois aux notes annexes.
    expect(joined).toContain('Note');
  });

  it('contient les colonnes contexture DGI (Réf., Libellé, Note, Montant N, Montant N-1)', async () => {
    const cap = captureTextCalls();
    try {
      await service.profitLossPdf(fakeProfitLoss(), 'ACME SARL');
    } finally {
      cap.restore();
    }
    const joined = cap.calls.join('||');
    expect(joined).toContain('Réf.');
    expect(joined).toContain('Libellé');
    expect(joined).toContain('Note');
    expect(joined).toContain('Montant N');
    expect(joined).toContain('Montant N-1');
  });
});

describe('ReportsPdfService — TFT W5.2 volet 2', () => {
  let service: ReportsPdfService;

  beforeEach(() => {
    service = new ReportsPdfService();
  });

  it('produit un buffer PDF non vide pour le TFT', async () => {
    const buf = await service.tftPdf(fakeTft(), 'ACME SARL');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('contient la nomenclature doctrine ZA → ZH (Tome 3 p. 34)', async () => {
    const cap = captureTextCalls();
    try {
      await service.tftPdf(fakeTft(), 'ACME SARL');
    } finally {
      cap.restore();
    }
    const joined = cap.calls.join('||');
    for (const code of ['ZA', 'ZB', 'ZC', 'ZD', 'ZE', 'ZF', 'ZG', 'ZH']) {
      expect(joined).toContain(code);
    }
  });

  it('indique la méthode indirecte et la devise XOF', async () => {
    const cap = captureTextCalls();
    try {
      await service.tftPdf(fakeTft(), 'ACME SARL');
    } finally {
      cap.restore();
    }
    const joined = cap.calls.join('||');
    expect(joined).toContain('XOF');
    expect(joined).toMatch(/méthode indirecte/i);
  });
});
