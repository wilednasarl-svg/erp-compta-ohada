import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { BalanceSheetQueryDto } from '../dto/balance-sheet-query.dto';
import { AgingBalanceQueryDto } from '../dto/aging-balance-query.dto';
import { AnnexeNoteDetailQueryDto } from '../dto/annexe-note-detail-query.dto';
import { AnnexeQueryDto } from '../dto/annexe-query.dto';
import { AnnualPackageQueryDto } from '../dto/annual-package-query.dto';
import { DsfPackageQueryDto } from '../dto/dsf-package-query.dto';
import { MarginByAxisQueryDto } from '../dto/margin-by-axis-query.dto';
import { PeriodQueryDto } from '../dto/period-query.dto';
import { CashTrendQueryDto } from '../dto/cash-trend-query.dto';
import { ComparativeBalanceQueryDto } from '../dto/comparative-balance-query.dto';
import { MultiYearBalanceQueryDto } from '../dto/multi-year-balance-query.dto';
import { FinancialRatiosQueryDto } from '../dto/financial-ratios-query.dto';
import { GeneralLedgerQueryDto } from '../dto/general-ledger-query.dto';
import { ProfitLossQueryDto } from '../dto/profit-loss-query.dto';
import { SigQueryDto } from '../dto/sig-query.dto';
import { TrialBalanceQueryDto } from '../dto/trial-balance-query.dto';
import {
  ReportsService,
  type BalanceSheetReport,
  type AgingBalanceReport,
  type AnalyticAxisSummary,
  type AnnexeNoteDetailReport,
  type AnnexeReport,
  type CashTrendReport,
  type ImportDiagnosticReport,
  type ComparativeBalanceReport,
  type MarginByAxisReport,
  type MultiYearBalanceReport,
  type FinancialRatiosReport,
  type GeneralLedgerReport,
  type ProfitLossReport,
  type SigReport,
  type TrialBalanceReport,
} from '../services/reports.service';
import { CashFlowService, type CashFlowReport } from '../services/cash-flow.service';
import {
  DsfValidatorService,
  type DsfValidationReport,
} from '../services/dsf-validator.service';
import { ReportsPackageService } from '../services/reports-package.service';
import { ReportsPdfService } from '../services/reports-pdf.service';
import { ReportsXlsxService } from '../services/reports-xlsx.service';
import {
  AgingBalanceReportEnvelope,
  AnalyticAxisSummaryListResponse,
  AnnexeNoteDetailReportEnvelope,
  AnnexeReportEnvelope,
  BalanceSheetReportEnvelope,
  CashTrendReportEnvelope,
  ComparativeBalanceReportEnvelope,
  DsfValidationReportEnvelope,
  FinancialRatiosReportEnvelope,
  GeneralLedgerReportEnvelope,
  ImportDiagnosticReportEnvelope,
  MarginByAxisReportEnvelope,
  MultiYearBalanceReportEnvelope,
  ProfitLossReportEnvelope,
  SigReportEnvelope,
  TftReportEnvelope,
  TrialBalanceReportEnvelope,
} from '../dto/responses';

/**
 * `ReportsController` — Module 9 financial reports.
 *
 * JSON endpoints (waves 1-2):
 *   GET /organizations/:id/reports/trial-balance
 *   GET /organizations/:id/reports/general-ledger/:accountId
 *   GET /organizations/:id/reports/profit-loss
 *   GET /organizations/:id/reports/balance-sheet
 *
 * Export endpoints (wave 3):
 *   GET /organizations/:id/reports/trial-balance.pdf
 *   GET /organizations/:id/reports/trial-balance.xlsx
 *   GET /organizations/:id/reports/general-ledger/:accountId.pdf
 *   GET /organizations/:id/reports/general-ledger/:accountId.xlsx
 *   GET /organizations/:id/reports/profit-loss.pdf
 *   GET /organizations/:id/reports/profit-loss.xlsx
 *   GET /organizations/:id/reports/balance-sheet.pdf
 *   GET /organizations/:id/reports/balance-sheet.xlsx
 *
 * All endpoints require `journals.reports` permission.
 */
@ApiTags('Reports')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/reports')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly pdf: ReportsPdfService,
    private readonly xlsx: ReportsXlsxService,
    private readonly packageBuilder: ReportsPackageService,
    private readonly dsfValidator: DsfValidatorService,
    private readonly cashFlow: CashFlowService,
  ) {}

  // ─── W5.4 — Validation pré-dépôt DSF ─────────────────────────────

  @Get('dsf-validate/:exerciseId')
  @RequirePermission('journals.reports')
  @ApiOperation({
    summary:
      "Validation pré-dépôt DSF (W5.4) — checks d'équilibre Bilan + balance, clôture périodes, complétude notes annexes, comptes non classés. Verdict PASS/WARN/BLOCK.",
  })
  @ApiOkResponse({ type: DsfValidationReportEnvelope })
  async dsfValidate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Param('exerciseId', new ParseUUIDPipe({ version: '4' })) exerciseId: string,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: DsfValidationReport }> {
    const report = await this.dsfValidator.validate(asTenantId(org.id), exerciseId);
    return { report };
  }

  // ─── JSON endpoints (existing waves 1-2) ─────────────────────────

  // ─── W5.3 — Liasse DSF complète déposable ────────────────────────
  @Get('dsf-package.zip')
  @RequirePermission('journals.reports')
  @ApiOperation({
    summary:
      'Liasse DSF SYSCOHADA déposable (W5.3) — page de garde + R1-R4 + Bilan + CR + TFT (PDF & XLSX) + 36 notes annexes (JSON).',
  })
  @ApiProduces('application/zip')
  async dsfPackage(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: DsfPackageQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.packageBuilder.buildDsfPackage(
      asTenantId(org.id),
      query.exerciseId,
      {
        fromDate: query.fromDate,
        toDate: query.toDate,
        fiscalYearStartDate: query.fiscalYearStartDate,
        orgName: org.name,
      },
    );
    const slug = (org.name ?? 'organization')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    this.sendFile(
      res,
      buffer,
      'application/zip',
      `dsf-${slug}-${query.toDate}.zip`,
    );
  }

  @Get('annual-package.zip')
  @RequirePermission('journals.reports')
  @ApiOperation({
    summary: 'Dossier annuel SYSCOHADA en ZIP (Balance + CR officiel + Bilan + SIG + Ratios + TFT + Annexe + Aging clients/fournisseurs)',
  })
  @ApiProduces('application/zip')
  async annualPackage(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: AnnualPackageQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.packageBuilder.buildAnnualPackage(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
      orgName: org.name,
    });
    this.sendFile(
      res,
      buffer,
      'application/zip',
      this.filename(org.name, 'dossier-annuel', query.fromDate, query.toDate, 'zip'),
    );
  }

  @Get('trial-balance')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Balance générale (par compte, sur la période)' })
  @ApiOkResponse({ type: TrialBalanceReportEnvelope })
  async trialBalance(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: TrialBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: TrialBalanceReport }> {
    const report = await this.reports.getTrialBalance(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      accountClass: query.accountClass,
      accountCodeFrom: query.accountCodeFrom,
      accountCodeTo: query.accountCodeTo,
      hideEmpty: query.hideEmpty,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    return { report };
  }

  @Get('comparative-balance')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Balance comparative N / N-1 (mouvements deux exercices + solde cumulé)',
  })
  @ApiOkResponse({ type: ComparativeBalanceReportEnvelope })
  async comparativeBalance(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: ComparativeBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: ComparativeBalanceReport }> {
    const report = await this.reports.getComparativeBalance(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      previousFromDate: query.previousFromDate,
      previousToDate: query.previousToDate,
      accountClass: query.accountClass,
      accountCodeFrom: query.accountCodeFrom,
      accountCodeTo: query.accountCodeTo,
      hideEmpty: query.hideEmpty,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    return { report };
  }

  @Get('multi-year-balance')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Balance pluri-exercices (2 à 5 périodes côte à côte)' })
  @ApiOkResponse({ type: MultiYearBalanceReportEnvelope })
  async multiYearBalance(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: MultiYearBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: MultiYearBalanceReport }> {
    const report = await this.reports.getMultiYearBalance(
      asTenantId(org.id),
      this.buildMultiYearQuery(query),
    );
    return { report };
  }

  @Get('multi-year-balance.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Balance pluri-exercices' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async multiYearBalanceXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: MultiYearBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getMultiYearBalance(
      asTenantId(org.id),
      this.buildMultiYearQuery(query),
    );
    const buffer = this.xlsx.multiYearBalanceXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(
        org.name,
        'balance-pluri-exercices',
        report.periods[0].fromDate,
        report.periods[report.periods.length - 1].toDate,
        'xlsx',
      ),
    );
  }

  private buildMultiYearQuery(q: MultiYearBalanceQueryDto): {
    periods: Array<{ fromDate: string; toDate: string }>;
    accountClass?: number;
    accountCodeFrom?: string;
    accountCodeTo?: string;
    hideEmpty?: boolean;
    analyticAxisType?: string;
    analyticAxisCode?: string;
  } {
    const periods = [{ fromDate: q.period1FromDate, toDate: q.period1ToDate }];
    periods.push({ fromDate: q.period2FromDate, toDate: q.period2ToDate });
    if (q.period3FromDate !== undefined && q.period3ToDate !== undefined) {
      periods.push({ fromDate: q.period3FromDate, toDate: q.period3ToDate });
    }
    if (q.period4FromDate !== undefined && q.period4ToDate !== undefined) {
      periods.push({ fromDate: q.period4FromDate, toDate: q.period4ToDate });
    }
    if (q.period5FromDate !== undefined && q.period5ToDate !== undefined) {
      periods.push({ fromDate: q.period5FromDate, toDate: q.period5ToDate });
    }
    return {
      periods,
      accountClass: q.accountClass,
      accountCodeFrom: q.accountCodeFrom,
      accountCodeTo: q.accountCodeTo,
      hideEmpty: q.hideEmpty,
      analyticAxisType: q.analyticAxisType,
      analyticAxisCode: q.analyticAxisCode,
    };
  }

  @Get('general-ledger/:accountId')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grand livre d un compte (chronologique + cumul)' })
  @ApiOkResponse({ type: GeneralLedgerReportEnvelope })
  async generalLedger(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Query() query: GeneralLedgerQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: GeneralLedgerReport }> {
    const report = await this.reports.getGeneralLedger(asTenantId(org.id), {
      accountId,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    return { report };
  }

  @Get('profit-loss')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compte de résultat (classes 6 charges + 7 produits) sur la période',
  })
  @ApiOkResponse({ type: ProfitLossReportEnvelope })
  async profitLoss(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: ProfitLossQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: ProfitLossReport }> {
    const compareWith =
      query.compareFromDate !== undefined && query.compareToDate !== undefined
        ? { fromDate: query.compareFromDate, toDate: query.compareToDate }
        : undefined;
    const report = await this.reports.getProfitLoss(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      compareWith,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    return { report };
  }

  @Get('sig')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soldes Intermédiaires de Gestion (SIG) — cascade SYSCOHADA XA → XI',
  })
  @ApiOkResponse({ type: SigReportEnvelope })
  async sig(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: SigQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: SigReport }> {
    const compareWith =
      query.compareFromDate !== undefined && query.compareToDate !== undefined
        ? { fromDate: query.compareFromDate, toDate: query.compareToDate }
        : undefined;
    const report = await this.reports.getSig(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      compareWith,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    return { report };
  }

  @Get('balance-sheet')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bilan OHADA (actif/passif ventilés selon SYSCOHADA AUDCIF) à une date',
  })
  @ApiOkResponse({ type: BalanceSheetReportEnvelope })
  async balanceSheet(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: BalanceSheetQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: BalanceSheetReport }> {
    const compareWith =
      query.compareAsAtDate !== undefined
        ? {
            asAtDate: query.compareAsAtDate,
            fiscalYearStartDate: query.compareFiscalYearStartDate,
          }
        : undefined;
    const report = await this.reports.getBalanceSheet(asTenantId(org.id), {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
      compareWith,
    });
    return { report };
  }

  @Get('import-diagnostic/:sessionId')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Diagnostic d'import — balance des comptes + anomalies + plan de normalisation pour une session d'import (lit le staging, PAS les journaux validés)",
  })
  @ApiOkResponse({ type: ImportDiagnosticReportEnvelope })
  async importDiagnostic(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: ImportDiagnosticReport }> {
    const report = await this.reports.getImportDiagnostic(asTenantId(org.id), sessionId);
    return { report };
  }

  @Get('import-diagnostic/:sessionId.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({
    summary: "Export PDF — Diagnostic d'import (rapport de conformité)",
  })
  @ApiProduces('application/pdf')
  async importDiagnosticPdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getImportDiagnostic(asTenantId(org.id), sessionId);
    const buffer = await this.pdf.importDiagnosticPdf(report, org.name);
    const dateStamp = report.session.createdAt.slice(0, 10);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(org.name, 'diagnostic-import', dateStamp, undefined, 'pdf'),
    );
  }

  @Get('tft')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'TFT (Tableau Flux Trésorerie - méthode indirecte) — OHADA Vol. 3 p. 34' })
  @ApiOkResponse({ type: TftReportEnvelope })
  async tft(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: PeriodQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: CashFlowReport }> {
    const report = await this.cashFlow.getCashFlow(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    return { report };
  }

  @Get('annexe')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Annexe (Notes 1-36 SYSCOHADA AUDCIF) — squelette + statut' })
  @ApiOkResponse({ type: AnnexeReportEnvelope })
  async annexe(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: AnnexeQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: AnnexeReport }> {
    const report = await this.reports.getAnnexe(asTenantId(org.id), {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
    });
    return { report };
  }

  @Get('annexe/note')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Détail d'une note d'annexe (3A, 5, 15, 20 implémentés)" })
  @ApiOkResponse({ type: AnnexeNoteDetailReportEnvelope })
  async annexeNoteDetail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: AnnexeNoteDetailQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: AnnexeNoteDetailReport }> {
    const report = await this.reports.getAnnexeNoteDetail(asTenantId(org.id), {
      noteCode: query.noteCode,
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
    });
    return { report };
  }

  @Get('margin-by-axis')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Marge brute par axe analytique (chantier / BU / activité)" })
  @ApiOkResponse({ type: MarginByAxisReportEnvelope })
  async marginByAxis(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: MarginByAxisQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: MarginByAxisReport }> {
    const report = await this.reports.getMarginByAxis(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      axisType: query.axisType,
    });
    return { report };
  }

  @Get('margin-by-axis.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — Marge par activité (aligné Note 34)' })
  @ApiProduces('application/pdf')
  async marginByAxisPdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: MarginByAxisQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getMarginByAxis(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      axisType: query.axisType,
    });
    const buffer = await this.pdf.marginByAxisPdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(
        org.name,
        `marge-par-activite-${query.axisType}`,
        query.fromDate,
        query.toDate,
        'pdf',
      ),
    );
  }

  @Get('margin-by-axis.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Marge par activité (aligné Note 34)' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async marginByAxisXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: MarginByAxisQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getMarginByAxis(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      axisType: query.axisType,
    });
    const buffer = this.xlsx.marginByAxisXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(
        org.name,
        `marge-par-activite-${query.axisType}`,
        query.fromDate,
        query.toDate,
        'xlsx',
      ),
    );
  }

  @Get('analytic-axes')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Liste les axes analytiques utilisés dans l'organisation (avec compteurs)",
  })
  @ApiOkResponse({ type: AnalyticAxisSummaryListResponse })
  async analyticAxes(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ axes: AnalyticAxisSummary[] }> {
    const axes = await this.reports.listAnalyticAxes(asTenantId(org.id), { fromDate, toDate });
    return { axes };
  }

  @Get('aging-balance')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Balance âgée clients ou fournisseurs (FIFO sur lignes)' })
  @ApiOkResponse({ type: AgingBalanceReportEnvelope })
  async agingBalance(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: AgingBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: AgingBalanceReport }> {
    const report = await this.reports.getAgingBalance(asTenantId(org.id), {
      side: query.side,
      asAtDate: query.asAtDate,
      bucketBoundaries: query.bucketBoundaries,
    });
    return { report };
  }

  @Get('tft.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — TFT OHADA (méthode indirecte)' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async tftXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: PeriodQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.cashFlow.getCashFlow(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    const buffer = this.xlsx.tftXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(org.name, 'tft', query.fromDate, query.toDate, 'xlsx'),
    );
  }

  @Get('annexe.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Annexe (Notes 1-36)' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async annexeXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: AnnexeQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getAnnexe(asTenantId(org.id), {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
    });
    const buffer = this.xlsx.annexeXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(org.name, 'annexe', query.asAtDate, undefined, 'xlsx'),
    );
  }

  @Get('aging-balance.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Balance âgée' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async agingBalanceXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: AgingBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getAgingBalance(asTenantId(org.id), {
      side: query.side,
      asAtDate: query.asAtDate,
      bucketBoundaries: query.bucketBoundaries,
    });
    const buffer = this.xlsx.agingBalanceXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(
        org.name,
        `balance-agee-${query.side.toLowerCase()}`,
        query.asAtDate,
        undefined,
        'xlsx',
      ),
    );
  }

  @Get('cash-trend')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trésorerie nette glissante mois par mois (classe 5)' })
  @ApiOkResponse({ type: CashTrendReportEnvelope })
  async cashTrend(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: CashTrendQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: CashTrendReport }> {
    const report = await this.reports.getCashTrend(asTenantId(org.id), {
      fromMonth: query.fromMonth,
      toMonth: query.toMonth,
    });
    return { report };
  }

  @Get('cash-trend.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Trésorerie nette glissante' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async cashTrendXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: CashTrendQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getCashTrend(asTenantId(org.id), {
      fromMonth: query.fromMonth,
      toMonth: query.toMonth,
    });
    const buffer = this.xlsx.cashTrendXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(org.name, 'tresorerie-glissante', query.fromMonth, query.toMonth, 'xlsx'),
    );
  }

  @Get('financial-ratios')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ratios financiers (structure, liquidité, solvabilité, rentabilité)' })
  @ApiOkResponse({ type: FinancialRatiosReportEnvelope })
  async financialRatios(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: FinancialRatiosQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: FinancialRatiosReport }> {
    const report = await this.reports.getFinancialRatios(asTenantId(org.id), {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
    });
    return { report };
  }

  @Get('financial-ratios.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Ratios financiers' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async financialRatiosXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: FinancialRatiosQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getFinancialRatios(asTenantId(org.id), {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
    });
    const buffer = this.xlsx.financialRatiosXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(org.name, 'ratios-financiers', query.asAtDate, undefined, 'xlsx'),
    );
  }

  // ─── PDF export endpoints (wave 3) ──────────────────────────────

  @Get('trial-balance.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — Balance générale' })
  @ApiProduces('application/pdf')
  async trialBalancePdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: TrialBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getTrialBalance(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      accountClass: query.accountClass,
      accountCodeFrom: query.accountCodeFrom,
      accountCodeTo: query.accountCodeTo,
      hideEmpty: query.hideEmpty,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    const buffer = await this.pdf.trialBalancePdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(org.name, 'balance-generale', query.fromDate, query.toDate, 'pdf'),
    );
  }

  @Get('general-ledger/:accountId.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — Grand livre' })
  @ApiProduces('application/pdf')
  async generalLedgerPdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Query() query: GeneralLedgerQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getGeneralLedger(asTenantId(org.id), {
      accountId,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    const buffer = await this.pdf.generalLedgerPdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(
        org.name,
        `grand-livre-${report.accountCode}`,
        query.fromDate,
        query.toDate,
        'pdf',
      ),
    );
  }

  @Get('profit-loss.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — Compte de résultat' })
  @ApiProduces('application/pdf')
  async profitLossPdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: ProfitLossQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const compareWith =
      query.compareFromDate && query.compareToDate
        ? { fromDate: query.compareFromDate, toDate: query.compareToDate }
        : undefined;
    const report = await this.reports.getProfitLoss(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      compareWith,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    const buffer = await this.pdf.profitLossPdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(org.name, 'compte-de-resultat', query.fromDate, query.toDate, 'pdf'),
    );
  }

  @Get('balance-sheet.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — Bilan OHADA' })
  @ApiProduces('application/pdf')
  async balanceSheetPdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: BalanceSheetQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const compareWith = query.compareAsAtDate
      ? { asAtDate: query.compareAsAtDate, fiscalYearStartDate: query.compareFiscalYearStartDate }
      : undefined;
    const report = await this.reports.getBalanceSheet(asTenantId(org.id), {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
      compareWith,
    });
    const buffer = await this.pdf.balanceSheetPdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(org.name, 'bilan', query.asAtDate, undefined, 'pdf'),
    );
  }

  @Get('sig.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — SIG' })
  @ApiProduces('application/pdf')
  async sigPdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: SigQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const compareWith =
      query.compareFromDate !== undefined && query.compareToDate !== undefined
        ? { fromDate: query.compareFromDate, toDate: query.compareToDate }
        : undefined;
    const report = await this.reports.getSig(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      compareWith,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    const buffer = await this.pdf.sigPdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(org.name, 'sig', query.fromDate, query.toDate, 'pdf'),
    );
  }

  @Get('financial-ratios.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — Ratios financiers' })
  @ApiProduces('application/pdf')
  async financialRatiosPdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: FinancialRatiosQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getFinancialRatios(asTenantId(org.id), {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
    });
    const buffer = await this.pdf.financialRatiosPdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(org.name, 'ratios-financiers', query.asAtDate, undefined, 'pdf'),
    );
  }

  @Get('aging-balance.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — Balance âgée' })
  @ApiProduces('application/pdf')
  async agingBalancePdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: AgingBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getAgingBalance(asTenantId(org.id), {
      side: query.side,
      asAtDate: query.asAtDate,
      bucketBoundaries: query.bucketBoundaries,
    });
    const buffer = await this.pdf.agingBalancePdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(
        org.name,
        `balance-agee-${query.side.toLowerCase()}`,
        query.asAtDate,
        undefined,
        'pdf',
      ),
    );
  }

  @Get('cash-trend.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — Trésorerie nette glissante' })
  @ApiProduces('application/pdf')
  async cashTrendPdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: CashTrendQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getCashTrend(asTenantId(org.id), {
      fromMonth: query.fromMonth,
      toMonth: query.toMonth,
    });
    const buffer = await this.pdf.cashTrendPdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(org.name, 'tresorerie-glissante', query.fromMonth, query.toMonth, 'pdf'),
    );
  }

  @Get('tft.pdf')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export PDF — TFT' })
  @ApiProduces('application/pdf')
  async tftPdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: PeriodQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.cashFlow.getCashFlow(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    const buffer = await this.pdf.tftPdf(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/pdf',
      this.filename(org.name, 'tft', query.fromDate, query.toDate, 'pdf'),
    );
  }

  // ─── Excel export endpoints (wave 3) ────────────────────────────

  @Get('trial-balance.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Balance générale' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async trialBalanceXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: TrialBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getTrialBalance(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      accountClass: query.accountClass,
      accountCodeFrom: query.accountCodeFrom,
      accountCodeTo: query.accountCodeTo,
      hideEmpty: query.hideEmpty,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    const buffer = this.xlsx.trialBalanceXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(org.name, 'balance-generale', query.fromDate, query.toDate, 'xlsx'),
    );
  }

  @Get('comparative-balance.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Balance comparative N / N-1' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async comparativeBalanceXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: ComparativeBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getComparativeBalance(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      previousFromDate: query.previousFromDate,
      previousToDate: query.previousToDate,
      accountClass: query.accountClass,
      accountCodeFrom: query.accountCodeFrom,
      accountCodeTo: query.accountCodeTo,
      hideEmpty: query.hideEmpty,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    const buffer = this.xlsx.comparativeBalanceXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(
        org.name,
        'balance-comparative',
        query.previousFromDate,
        query.toDate,
        'xlsx',
      ),
    );
  }

  @Get('general-ledger/:accountId.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Grand livre' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async generalLedgerXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Query() query: GeneralLedgerQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.getGeneralLedger(asTenantId(org.id), {
      accountId,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    const buffer = this.xlsx.generalLedgerXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(
        org.name,
        `grand-livre-${report.accountCode}`,
        query.fromDate,
        query.toDate,
        'xlsx',
      ),
    );
  }

  @Get('profit-loss.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Compte de résultat' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async profitLossXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: ProfitLossQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const compareWith =
      query.compareFromDate && query.compareToDate
        ? { fromDate: query.compareFromDate, toDate: query.compareToDate }
        : undefined;
    const report = await this.reports.getProfitLoss(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      compareWith,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    const buffer = this.xlsx.profitLossXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(org.name, 'compte-de-resultat', query.fromDate, query.toDate, 'xlsx'),
    );
  }

  @Get('profit-loss-official.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({
    summary: 'Export Excel — Compte de Résultat OFFICIEL (cascade Vol. 3 SYSCOHADA)',
  })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async profitLossOfficialXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: SigQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const compareWith =
      query.compareFromDate !== undefined && query.compareToDate !== undefined
        ? { fromDate: query.compareFromDate, toDate: query.compareToDate }
        : undefined;
    const report = await this.reports.getSig(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      compareWith,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    const buffer = this.xlsx.profitLossOfficialXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(
        org.name,
        'compte-resultat-officiel',
        query.fromDate,
        query.toDate,
        'xlsx',
      ),
    );
  }

  @Get('sig.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Soldes Intermédiaires de Gestion' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async sigXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: SigQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const compareWith =
      query.compareFromDate !== undefined && query.compareToDate !== undefined
        ? { fromDate: query.compareFromDate, toDate: query.compareToDate }
        : undefined;
    const report = await this.reports.getSig(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      compareWith,
      analyticAxisType: query.analyticAxisType,
      analyticAxisCode: query.analyticAxisCode,
    });
    const buffer = this.xlsx.sigXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(org.name, 'sig', query.fromDate, query.toDate, 'xlsx'),
    );
  }

  @Get('balance-sheet-official.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({
    summary: 'Export Excel — Bilan OFFICIEL avec codes de poste OHADA (AE/AI/AM/AZ/CH/CL/CR/CU/DZ)',
  })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async balanceSheetOfficialXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: BalanceSheetQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const compareWith = query.compareAsAtDate
      ? { asAtDate: query.compareAsAtDate, fiscalYearStartDate: query.compareFiscalYearStartDate }
      : undefined;
    const report = await this.reports.getBalanceSheet(asTenantId(org.id), {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
      compareWith,
    });
    const buffer = this.xlsx.balanceSheetOfficialXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(org.name, 'bilan-officiel', query.asAtDate, undefined, 'xlsx'),
    );
  }

  @Get('balance-sheet.xlsx')
  @RequirePermission('journals.reports')
  @ApiOperation({ summary: 'Export Excel — Bilan OHADA' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async balanceSheetXlsx(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: BalanceSheetQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
    @Res() res: Response,
  ): Promise<void> {
    const compareWith = query.compareAsAtDate
      ? { asAtDate: query.compareAsAtDate, fiscalYearStartDate: query.compareFiscalYearStartDate }
      : undefined;
    const report = await this.reports.getBalanceSheet(asTenantId(org.id), {
      asAtDate: query.asAtDate,
      fiscalYearStartDate: query.fiscalYearStartDate,
      compareWith,
    });
    const buffer = this.xlsx.balanceSheetXlsx(report, org.name);
    this.sendFile(
      res,
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      this.filename(org.name, 'bilan', query.asAtDate, undefined, 'xlsx'),
    );
  }

  // ─── Internal helpers ───────────────────────────────────────────

  /**
   * Sends a binary file as an attachment response. Uses `@Res()` to
   * bypass NestJS's global response interceptor and emit raw bytes.
   */
  private sendFile(res: Response, buffer: Buffer, contentType: string, downloadName: string): void {
    res
      .set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-store',
      })
      .end(buffer);
  }

  /**
   * Builds a descriptive filename: `OrgName_report-name_from_to.ext`
   * Slugifies the org name to be filesystem-safe.
   */
  private filename(
    orgName: string,
    reportName: string,
    fromOrAt: string,
    toDate: string | undefined,
    ext: string,
  ): string {
    const slug = orgName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 40);
    const period = toDate ? `${fromOrAt}_${toDate}` : fromOrAt;
    return `${slug}_${reportName}_${period}.${ext}`;
  }
}
