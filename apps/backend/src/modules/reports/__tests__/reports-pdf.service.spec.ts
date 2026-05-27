import PDFDocument from 'pdfkit';

import { ReportsPdfService } from '../services/reports-pdf.service';
import type {
  BalanceSheetReport,
  BilanMasse,
  BilanPoste,
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
