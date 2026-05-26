import type { Response } from 'express';

import type { CurrentOrgContext } from '../../../common/types/request-context';
import { ReportsController } from '../controllers/reports.controller';
import { AgingBalanceQueryDto } from '../dto/aging-balance-query.dto';
import { AnnexeNoteDetailQueryDto } from '../dto/annexe-note-detail-query.dto';
import { AnnualPackageQueryDto } from '../dto/annual-package-query.dto';
import { CashTrendQueryDto } from '../dto/cash-trend-query.dto';
import { FinancialRatiosQueryDto } from '../dto/financial-ratios-query.dto';
import { PeriodQueryDto } from '../dto/period-query.dto';
import { SigQueryDto } from '../dto/sig-query.dto';
import type {
  ReportsService,
  SigReport,
  AnnexeNoteDetailReport,
  AgingBalanceReport,
} from '../services/reports.service';
import type { ReportsPackageService } from '../services/reports-package.service';
import type { ReportsPdfService } from '../services/reports-pdf.service';
import type { ReportsXlsxService } from '../services/reports-xlsx.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const ORG: CurrentOrgContext = {
  id: ORG_ID,
  name: 'Gravel Ivoire',
} as CurrentOrgContext;

function buildHarness() {
  const reports = {
    getSig: jest.fn(),
    getFinancialRatios: jest.fn(),
    getAgingBalance: jest.fn(),
    getCashTrend: jest.fn(),
    getTafire: jest.fn(),
    getTft: jest.fn(),
    getAnnexe: jest.fn(),
    getAnnexeNoteDetail: jest.fn(),
  };
  const pdf = { sigPdf: jest.fn(), agingBalancePdf: jest.fn() };
  const xlsx = { sigXlsx: jest.fn() };
  const pkg = { buildAnnualPackage: jest.fn() };
  const dsfValidator = { validate: jest.fn() };
  const controller = new ReportsController(
    reports as unknown as ReportsService,
    pdf as unknown as ReportsPdfService,
    xlsx as unknown as ReportsXlsxService,
    pkg as unknown as ReportsPackageService,
    dsfValidator as unknown as import('../services/dsf-validator.service').DsfValidatorService,
  );
  return { controller, reports, pdf, xlsx, pkg, dsfValidator };
}

function buildRes(): Response {
  const res = {
    set: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('ReportsController.sig', () => {
  it('forwards the query to the service and wraps the report in an envelope', async () => {
    const h = buildHarness();
    const fake: SigReport = {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      charges: [],
      produits: [],
      soldes: [],
    };
    h.reports.getSig.mockResolvedValue(fake);
    const q = new SigQueryDto();
    q.fromDate = '2026-01-01';
    q.toDate = '2026-12-31';

    const result = await h.controller.sig(ORG_ID, q, ORG);

    expect(h.reports.getSig).toHaveBeenCalledWith(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      compareWith: undefined,
    });
    expect(result).toEqual({ report: fake });
  });

  it('passes compareWith when both compareFromDate and compareToDate are provided', async () => {
    const h = buildHarness();
    h.reports.getSig.mockResolvedValue({} as SigReport);
    const q = new SigQueryDto();
    q.fromDate = '2026-01-01';
    q.toDate = '2026-12-31';
    q.compareFromDate = '2025-01-01';
    q.compareToDate = '2025-12-31';

    await h.controller.sig(ORG_ID, q, ORG);

    expect(h.reports.getSig).toHaveBeenCalledWith(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      compareWith: { fromDate: '2025-01-01', toDate: '2025-12-31' },
    });
  });

  it('omits compareWith when only one compare bound is set (defensive)', async () => {
    const h = buildHarness();
    h.reports.getSig.mockResolvedValue({} as SigReport);
    const q = new SigQueryDto();
    q.fromDate = '2026-01-01';
    q.toDate = '2026-12-31';
    q.compareFromDate = '2025-01-01';
    // q.compareToDate intentionally left undefined

    await h.controller.sig(ORG_ID, q, ORG);

    expect(h.reports.getSig).toHaveBeenCalledWith(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      compareWith: undefined,
    });
  });
});

describe('ReportsController.agingBalance', () => {
  it('forwards side + asAtDate + bucketBoundaries', async () => {
    const h = buildHarness();
    const fake: AgingBalanceReport = {
      side: 'CLIENT',
      asAtDate: '2026-12-31',
      bucketBoundaries: [30, 60, 90, 180],
      rows: [],
      bucketTotals: [],
      grandTotal: '0.00',
    };
    h.reports.getAgingBalance.mockResolvedValue(fake);
    const q = new AgingBalanceQueryDto();
    q.side = 'CLIENT';
    q.asAtDate = '2026-12-31';
    q.bucketBoundaries = [30, 60];

    const result = await h.controller.agingBalance(ORG_ID, q, ORG);

    expect(h.reports.getAgingBalance).toHaveBeenCalledWith(ORG_ID, {
      side: 'CLIENT',
      asAtDate: '2026-12-31',
      bucketBoundaries: [30, 60],
    });
    expect(result).toEqual({ report: fake });
  });

  it('streams the xlsx buffer with the right filename', async () => {
    const h = buildHarness();
    h.reports.getAgingBalance.mockResolvedValue({
      side: 'FOURNISSEUR',
      asAtDate: '2026-12-31',
      bucketBoundaries: [30],
      rows: [],
      bucketTotals: [],
      grandTotal: '0.00',
    });
    h.pdf.agingBalancePdf.mockResolvedValue(Buffer.from('fake-pdf'));
    const res = buildRes();
    const q = new AgingBalanceQueryDto();
    q.side = 'FOURNISSEUR';
    q.asAtDate = '2026-12-31';

    await h.controller.agingBalancePdf(ORG_ID, q, ORG, res);

    expect(h.pdf.agingBalancePdf).toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': expect.stringContaining('balance-agee-fournisseur'),
      }),
    );
    expect(res.end).toHaveBeenCalled();
  });
});

describe('ReportsController.annexeNoteDetail', () => {
  it('delegates to the service with the noteCode and dates', async () => {
    const h = buildHarness();
    const fake: AnnexeNoteDetailReport = {
      noteCode: 'Note 3A',
      title: 'Immobilisations',
      asAtDate: '2026-12-31',
      fiscalYearStartDate: '2026-01-01',
      rows: [],
      total: '0.00',
      coverage: 'COMPLETE',
    };
    h.reports.getAnnexeNoteDetail.mockResolvedValue(fake);
    const q = new AnnexeNoteDetailQueryDto();
    q.noteCode = 'Note 3A';
    q.asAtDate = '2026-12-31';
    q.fiscalYearStartDate = '2026-01-01';

    const result = await h.controller.annexeNoteDetail(ORG_ID, q, ORG);

    expect(h.reports.getAnnexeNoteDetail).toHaveBeenCalledWith(ORG_ID, {
      noteCode: 'Note 3A',
      asAtDate: '2026-12-31',
      fiscalYearStartDate: '2026-01-01',
    });
    expect(result).toEqual({ report: fake });
  });

  it('returns UNSUPPORTED coverage for unimplemented notes (passed through from service)', async () => {
    const h = buildHarness();
    const fake: AnnexeNoteDetailReport = {
      noteCode: 'Note 99',
      title: 'Note non implémentée en détail (V1)',
      asAtDate: '2026-12-31',
      fiscalYearStartDate: '2026-01-01',
      rows: [],
      total: '0.00',
      coverage: 'UNSUPPORTED',
      methodology: 'À venir.',
    };
    h.reports.getAnnexeNoteDetail.mockResolvedValue(fake);
    const q = new AnnexeNoteDetailQueryDto();
    q.noteCode = 'Note 99';
    q.asAtDate = '2026-12-31';
    q.fiscalYearStartDate = '2026-01-01';

    const result = await h.controller.annexeNoteDetail(ORG_ID, q, ORG);

    expect(result.report.coverage).toBe('UNSUPPORTED');
  });
});

describe('ReportsController.annualPackage', () => {
  it('streams the ZIP buffer with content-type application/zip', async () => {
    const h = buildHarness();
    const fakeBuffer = Buffer.from('PK\x03\x04 fake-zip');
    h.pkg.buildAnnualPackage.mockResolvedValue(fakeBuffer);
    const res = buildRes();
    const q = new AnnualPackageQueryDto();
    q.fromDate = '2026-01-01';
    q.toDate = '2026-12-31';

    await h.controller.annualPackage(ORG_ID, q, ORG, res);

    expect(h.pkg.buildAnnualPackage).toHaveBeenCalledWith(ORG_ID, {
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
      fiscalYearStartDate: undefined,
      orgName: 'Gravel Ivoire',
    });
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/zip',
        'Content-Disposition': expect.stringContaining('dossier-annuel'),
        'Content-Length': fakeBuffer.length.toString(),
      }),
    );
    expect(res.end).toHaveBeenCalledWith(fakeBuffer);
  });

  it('passes fiscalYearStartDate when provided', async () => {
    const h = buildHarness();
    h.pkg.buildAnnualPackage.mockResolvedValue(Buffer.from(''));
    const res = buildRes();
    const q = new AnnualPackageQueryDto();
    q.fromDate = '2026-01-01';
    q.toDate = '2026-12-31';
    q.fiscalYearStartDate = '2026-01-01';

    await h.controller.annualPackage(ORG_ID, q, ORG, res);

    expect(h.pkg.buildAnnualPackage).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ fiscalYearStartDate: '2026-01-01' }),
    );
  });
});

describe('ReportsController.cashTrend + tafire + tft + financialRatios', () => {
  it.each([
    ['cashTrend', 'getCashTrend', () => Object.assign(new CashTrendQueryDto(), { fromMonth: '2026-01', toMonth: '2026-12' })],
    ['tafire', 'getTafire', () => Object.assign(new PeriodQueryDto(), { fromDate: '2026-01-01', toDate: '2026-12-31' })],
    ['tft', 'getTft', () => Object.assign(new PeriodQueryDto(), { fromDate: '2026-01-01', toDate: '2026-12-31' })],
    [
      'financialRatios',
      'getFinancialRatios',
      () => Object.assign(new FinancialRatiosQueryDto(), { asAtDate: '2026-12-31', fiscalYearStartDate: '2026-01-01' }),
    ],
  ])('controller.%s calls reports.%s and wraps result', async (method, serviceMethod, queryBuilder) => {
    const h = buildHarness();
    (h.reports as Record<string, jest.Mock>)[serviceMethod].mockResolvedValue({ stub: true });
    const q = queryBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (h.controller as any)[method](ORG_ID, q, ORG);
    expect((h.reports as Record<string, jest.Mock>)[serviceMethod]).toHaveBeenCalled();
    expect(result).toEqual({ report: { stub: true } });
  });
});
