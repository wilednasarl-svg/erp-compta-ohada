import JSZip from 'jszip';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import { DsfFichesPdfService } from '../services/dsf-fiches-pdf.service';
import type { DsfIdentificationService } from '../services/dsf-identification.service';
import type {
  NotesAnnexesService,
  GetNoteRequest,
} from '../services/notes-annexes/notes-annexes.service';
import type { NoteContent } from '../services/notes-annexes/types';
import { NotImplementedError } from '../services/notes-annexes/types';
import { ReportsPackageService } from '../services/reports-package.service';
import { ReportsPdfService } from '../services/reports-pdf.service';
import type { ReportsService } from '../services/reports.service';
import { ReportsXlsxService } from '../services/reports-xlsx.service';
import type {
  BalanceSheetReport,
  ProfitLossReport,
} from '../services/reports.service';
import type {
  CashFlowReport,
  CashFlowService,
} from '../services/cash-flow.service';
import type { DsfIdentificationBundle } from '../types/dsf-profile.types';

/* ────────────────────────────────────────────────────────────────────
 * Test helpers — fixtures minimalistes pour BalanceSheet, PL, TFT.
 * ──────────────────────────────────────────────────────────────────── */

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const EXERCISE_ID = '11111111-2222-4333-8444-555555555555';

function buildBalanceSheet(): BalanceSheetReport {
  return {
    asAtDate: '2026-12-31',
    fiscalYearStartDate: '2026-01-01',
    actifMasses: [],
    passifMasses: [],
    totals: { actif: '0', passif: '0', difference: '0' },
    netResultIncorporated: null,
  } as unknown as BalanceSheetReport;
}

function buildProfitLoss(): ProfitLossReport {
  return {
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    charges: [],
    produits: [],
    lines: [],
    totalCharges: '0',
    totalProduits: '0',
    resultat: '0',
  } as unknown as ProfitLossReport;
}

function buildTft(): CashFlowReport {
  return {
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    openingCash: '0.00',
    operatingFlows: { code: 'ZB', label: 'Opérationnel', subtotal: '0.00', postes: [] },
    investingFlows: { code: 'ZC', label: 'Investissement', subtotal: '0.00', postes: [] },
    financingFlowsEquity: { code: 'ZD', label: 'Financement CP', subtotal: '0.00', postes: [] },
    financingFlowsDebt: { code: 'ZE', label: 'Financement CE', subtotal: '0.00', postes: [] },
    financingFlowsTotal: '0.00',
    netCashVariation: '0.00',
    closingCash: '0.00',
    coherenceCheck: '0.00',
  };
}

function buildFichesBundle(): DsfIdentificationBundle {
  return {
    coverPage: {
      organizationName: 'Acme SA',
      organizationSlug: 'acme-sa',
      legalForm: 'SA',
      capital: '10000000.00',
      currency: 'XOF',
      exerciseId: EXERCISE_ID,
      exerciseLabel: 'Exercice 2026',
      exerciseStartDate: '2026-01-01',
      exerciseEndDate: '2026-12-31',
      country: 'CIV',
    },
    r2: {
      organizationName: 'Acme SA',
      legalForm: 'SA',
      taxRegime: 'IS',
      country: 'CIV',
      ninea: '123456',
      rccm: 'CI-ABJ-2024-B-1234',
      siegeAddress: 'Plateau, Rue 12',
      siegeCity: 'Abidjan',
      phone: '+225 27 20 30 40 50',
      email: 'contact@acme.ci',
      activitySector: 'Commerce',
      workforceByQualification: { 'YA cadres': 5 },
      workforceTotal: 5,
    },
    r3: {
      directorName: 'Jean Dupont',
      directorTitle: 'DG',
      presidentName: 'M. Diakité',
      auditorName: 'Cabinet Bilan',
    },
    r4: {
      totalNotes: 2,
      applicableCount: 1,
      notApplicableCount: 1,
      entries: [
        { noteId: 'N1', status: 'APPLICABLE' },
        { noteId: 'N2', status: 'NOT_APPLICABLE' },
      ],
    },
  };
}

function buildComputedNote(id: string): NoteContent {
  return {
    id: id as NoteContent['id'],
    metadata: {
      id: id as NoteContent['id'],
      label: `Note ${id}`,
      section: 'BILAN',
      applicableByDefault: true,
    },
    applicable: true,
    rows: [
      { key: 'L1', label: 'Ligne 1', values: { amount: '1000.00' } },
    ],
    computedAt: new Date().toISOString(),
  };
}

function buildPendingNote(id: string): NoteContent {
  return {
    id: id as NoteContent['id'],
    metadata: {
      id: id as NoteContent['id'],
      label: `Note ${id}`,
      section: 'BILAN',
      applicableByDefault: true,
    },
    applicable: false,
    rows: [{ key: 'PENDING', label: 'Pending', values: { statut: 'PENDING' } }],
    computedAt: new Date().toISOString(),
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Construct service under test with mocked deps.
 * ──────────────────────────────────────────────────────────────────── */

function makeService(opts: {
  fichesBundle?: DsfIdentificationBundle;
  fichesError?: AppException;
  notes?: ReadonlyArray<NoteContent>;
  notesThrows?: boolean;
}): ReportsPackageService {
  const reports = {
    getBalanceSheet: jest.fn().mockResolvedValue(buildBalanceSheet()),
    getProfitLoss: jest.fn().mockResolvedValue(buildProfitLoss()),
    getTrialBalance: jest.fn(),
    getComparativeBalance: jest.fn(),
    getSig: jest.fn(),
    getFinancialRatios: jest.fn(),
    getAnnexe: jest.fn(),
    getAgingBalance: jest.fn(),
  } as unknown as ReportsService;

  const cashFlow = {
    getCashFlow: jest.fn().mockResolvedValue(buildTft()),
  } as unknown as CashFlowService;

  const xlsx = new ReportsXlsxService();
  const pdf = new ReportsPdfService();
  const dsfFichesPdf = new DsfFichesPdfService();

  const dsfIdentification = {
    buildAllFiches: jest.fn(async () => {
      if (opts.fichesError) throw opts.fichesError;
      return opts.fichesBundle ?? buildFichesBundle();
    }),
  } as unknown as DsfIdentificationService;

  const notesAnnexes = {
    getAllNotes: jest.fn(async (_req: GetNoteRequest) => {
      if (opts.notesThrows) throw new Error('boom');
      return opts.notes ?? [];
    }),
  } as unknown as NotesAnnexesService;

  return new ReportsPackageService(
    reports,
    xlsx,
    pdf,
    dsfFichesPdf,
    dsfIdentification,
    notesAnnexes,
    cashFlow,
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Specs.
 * ──────────────────────────────────────────────────────────────────── */

describe('ReportsPackageService.buildDsfPackage', () => {
  const baseOpts = {
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    fiscalYearStartDate: '2026-01-01',
    orgName: 'Acme SA',
  };

  it('produces a non-empty Buffer ≥ 5KB', async () => {
    const svc = makeService({
      notes: [buildComputedNote('N1'), buildComputedNote('N2')],
    });
    const buf = await svc.buildDsfPackage(ORG_ID, EXERCISE_ID, baseOpts);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThanOrEqual(5_000);
  });

  it('ZIP contains MANIFEST + R1 + Bilan + CR + TFT files', async () => {
    const svc = makeService({
      notes: [buildComputedNote('N1')],
    });
    const buf = await svc.buildDsfPackage(ORG_ID, EXERCISE_ID, baseOpts);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);

    expect(names).toEqual(expect.arrayContaining([
      '00-MANIFEST.txt',
      '01-page-de-garde-R1.pdf',
      '02-identification-R2.pdf',
      '03-dirigeants-R3.pdf',
      '04-applicabilite-R4.pdf',
      '10-bilan.pdf',
      '10-bilan.xlsx',
      '11-compte-resultat.pdf',
      '11-compte-resultat.xlsx',
      '12-tft.pdf',
      '12-tft.xlsx',
    ]));
  });

  it('ZIP contains a 20-notes-annexes/ folder with MANIFEST and computed notes', async () => {
    const svc = makeService({
      notes: [buildComputedNote('N1'), buildComputedNote('N3A')],
    });
    const buf = await svc.buildDsfPackage(ORG_ID, EXERCISE_ID, baseOpts);
    const zip = await JSZip.loadAsync(buf);

    expect(zip.file('20-notes-annexes/MANIFEST.txt')).not.toBeNull();
    const notesManifest = await zip
      .file('20-notes-annexes/MANIFEST.txt')!
      .async('string');
    expect(notesManifest).toContain('COMPUTED');
    expect(notesManifest).toContain('N1');
    expect(notesManifest).toContain('N3A');

    // Both computed notes produced JSON files.
    const jsonFiles = Object.keys(zip.files).filter((n) =>
      n.startsWith('20-notes-annexes/') && n.endsWith('.json'),
    );
    expect(jsonFiles.length).toBe(2);
  });

  it('pending (stub) notes are placed under _pending/ instead of crashing', async () => {
    const svc = makeService({
      notes: [
        buildComputedNote('N1'),
        buildPendingNote('N3B'),
        buildPendingNote('N15'),
      ],
    });
    const buf = await svc.buildDsfPackage(ORG_ID, EXERCISE_ID, baseOpts);
    const zip = await JSZip.loadAsync(buf);

    const pendingFiles = Object.keys(zip.files).filter(
      (n) => n.startsWith('20-notes-annexes/_pending/') && !zip.files[n].dir,
    );
    expect(pendingFiles.length).toBe(2);
    expect(pendingFiles.some((n) => n.includes('N3B'))).toBe(true);
    expect(pendingFiles.some((n) => n.includes('N15'))).toBe(true);

    // Manifest summarizes counts correctly.
    const m = await zip.file('20-notes-annexes/MANIFEST.txt')!.async('string');
    expect(m).toMatch(/COMPUTED\s*:\s*1/);
    expect(m).toMatch(/STUB\s*:\s*2/);
  });

  it('falls back to default fiches and warns in MANIFEST when DSF profile is invalid', async () => {
    const svc = makeService({
      fichesError: new AppException(ERROR_CODES.DSF_PROFILE_INVALID, {
        message: 'missing NINEA',
      }),
      notes: [buildComputedNote('N1')],
    });
    const buf = await svc.buildDsfPackage(ORG_ID, EXERCISE_ID, baseOpts);
    const zip = await JSZip.loadAsync(buf);

    // R1 still produced via defaults.
    expect(zip.file('01-page-de-garde-R1.pdf')).not.toBeNull();
    const manifest = await zip.file('00-MANIFEST.txt')!.async('string');
    expect(manifest).toContain('AVERTISSEMENTS');
    expect(manifest).toMatch(/Profile DSF incomplet/);
  });

  it('rejects with DSF_PACKAGE_PROFILE_INCOMPLETE when accounting period is missing', async () => {
    const svc = makeService({
      fichesError: new AppException(ERROR_CODES.DSF_PROFILE_NOT_FOUND, {
        message: 'period not found',
      }),
    });
    await expect(
      svc.buildDsfPackage(ORG_ID, EXERCISE_ID, baseOpts),
    ).rejects.toMatchObject({ code: ERROR_CODES.DSF_PACKAGE_PROFILE_INCOMPLETE });
  });

  it('does not crash when getAllNotes itself throws — warning in MANIFEST instead', async () => {
    const svc = makeService({ notesThrows: true });
    const buf = await svc.buildDsfPackage(ORG_ID, EXERCISE_ID, baseOpts);
    const zip = await JSZip.loadAsync(buf);
    const manifest = await zip.file('00-MANIFEST.txt')!.async('string');
    expect(manifest).toContain('Notes annexes');
    expect(manifest).toContain('boom');
  });

  it('MANIFEST records the 4 états financiers compliance line', async () => {
    const svc = makeService({ notes: [] });
    const buf = await svc.buildDsfPackage(ORG_ID, EXERCISE_ID, baseOpts);
    const zip = await JSZip.loadAsync(buf);
    const manifest = await zip.file('00-MANIFEST.txt')!.async('string');
    expect(manifest).toContain('LIASSE DSF SYSCOHADA');
    expect(manifest).toContain('4 etats financiers');
    expect(manifest).toContain('contexture normalisee DGI');
  });

  it('uses NotImplementedError safely (sanity check on imported type)', () => {
    const e = new NotImplementedError('N3B' as never, 'W2.4.b');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('NotImplementedError');
  });
});
