import {
  REPORT_INPUT_CATALOG,
  REPORT_INPUT_CATALOG_BY_KEY,
  getReportInputSpec,
  getReportsForDocumentType,
} from '../data/report-input-catalog';
import { ReportInputCatalogController } from '../controllers/report-input-catalog.controller';
import { DOCUMENT_TYPES, type DocumentType } from '../../imports/types/import-status';
import { SOLDES_INTERMEDIAIRES } from '../services/syscohada-postes';

describe('Report input catalog', () => {
  it('exposes a unique, slug-shaped key for every report', () => {
    const keys = REPORT_INPUT_CATALOG.map((s) => s.reportKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('attaches at least one import requirement using a valid DocumentType', () => {
    for (const spec of REPORT_INPUT_CATALOG) {
      expect(spec.requiredImports.length).toBeGreaterThan(0);
      for (const req of spec.requiredImports) {
        expect(DOCUMENT_TYPES as readonly string[]).toContain(req.documentType);
        expect(req.rationale.trim().length).toBeGreaterThan(0);
        expect(typeof req.sufficientAlone).toBe('boolean');
      }
    }
  });

  it('declares at least one formula with output, expression and basis', () => {
    for (const spec of REPORT_INPUT_CATALOG) {
      expect(spec.formulas.length).toBeGreaterThan(0);
      for (const f of spec.formulas) {
        expect(f.output.trim().length).toBeGreaterThan(0);
        expect(f.expression.trim().length).toBeGreaterThan(0);
        expect(f.basis.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('documents source data, endpoint and legal basis for every report', () => {
    for (const spec of REPORT_INPUT_CATALOG) {
      expect(spec.sourceData.trim().length).toBeGreaterThan(0);
      expect(spec.endpoint.trim().length).toBeGreaterThan(0);
      expect(spec.legalRef).toMatch(/SYSCOHADA/);
      expect([
        'etats-financiers',
        'soldes-balances',
        'analyse',
        'consolidation',
        'liasses',
        'controle',
      ]).toContain(spec.category);
    }
  });

  it('covers the core SYSCOHADA financial statements', () => {
    const expected = [
      'balance-sheet',
      'profit-loss',
      'tft',
      'annexe',
      'sig',
      'financial-ratios',
      'trial-balance',
      'consolidated',
      'dsf-package',
    ];
    for (const key of expected) {
      expect(REPORT_INPUT_CATALOG_BY_KEY.has(key)).toBe(true);
    }
  });

  it('keeps SIG formulas in sync with the engine reference table (anti-drift)', () => {
    const sig = getReportInputSpec('sig');
    expect(sig).not.toBeNull();
    // Every SOLDES_INTERMEDIAIRES entry must appear verbatim in the catalog.
    for (const ref of SOLDES_INTERMEDIAIRES) {
      const match = sig?.formulas.find((f) => f.output.includes(`(${ref.code})`));
      expect(match).toBeDefined();
      expect(match?.expression).toBe(ref.formula);
    }
  });

  it('resolves reports by document type', () => {
    // Every importable DocumentType should feed at least one report, and the
    // canonical `entries` ingestion should feed the broadest set.
    for (const dt of DOCUMENT_TYPES as readonly DocumentType[]) {
      expect(getReportsForDocumentType(dt).length).toBeGreaterThan(0);
    }
    const entriesReports = getReportsForDocumentType('entries');
    expect(entriesReports.some((s) => s.reportKey === 'balance-sheet')).toBe(true);
    expect(entriesReports.some((s) => s.reportKey === 'sig')).toBe(true);
  });

  it('lets a uploaded trial balance produce Bilan + CR without entries', () => {
    const reports = getReportsForDocumentType('trial_balance');
    const fromBalance = reports.find((s) => s.reportKey === 'from-balance');
    expect(fromBalance).toBeDefined();
    expect(fromBalance?.requiredImports.some((r) => r.documentType === 'trial_balance' && r.sufficientAlone)).toBe(
      true,
    );
  });

  it('returns null for an unknown report key', () => {
    expect(getReportInputSpec('does-not-exist')).toBeNull();
  });
});

describe('ReportInputCatalogController', () => {
  const controller = new ReportInputCatalogController();

  it('returns the full catalog', () => {
    const { reports } = controller.getCatalog();
    expect(reports).toBe(REPORT_INPUT_CATALOG);
    expect(reports.length).toBeGreaterThan(0);
  });

  it('returns a single report spec by key', () => {
    expect(controller.getOne('sig').report?.reportKey).toBe('sig');
    expect(controller.getOne('nope').report).toBeNull();
  });

  it('returns reports for a valid document type and empty for an invalid one', () => {
    const ok = controller.getByDocumentType('entries');
    expect(ok.reports.length).toBeGreaterThan(0);
    const bad = controller.getByDocumentType('not-a-type');
    expect(bad.reports).toEqual([]);
  });
});
