import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import type {
  BalanceSheetGroup,
  BalanceSheetReport,
  GeneralLedgerReport,
  ProfitLossAccountLine,
  ProfitLossReport,
  TrialBalanceReport,
} from './reports.service';

/**
 * `ReportsPdfService` — Module 9 wave 3 PDF rendering.
 *
 * Generates A4-landscape PDFs for each report type using `pdfkit`.
 * Each page includes:
 *   - Org name as header
 *   - Report title + period
 *   - «SYSCOHADA – Réf. AUDCIF» stamp line
 *   - Tabular rows
 *   - Page numbering footer
 */
@Injectable()
export class ReportsPdfService {
  // ─── Shared constants ────────────────────────────────────────────
  private static readonly MARGIN = 40;
  private static readonly FONT_SIZE_HEADER = 14;
  private static readonly FONT_SIZE_SUBTITLE = 10;
  private static readonly FONT_SIZE_TABLE = 8;
  private static readonly LINE_HEIGHT = 14;
  private static readonly COL_GAP = 6;
  private static readonly OHADA_STAMP = `Referentiel SYSCOHADA - Acte Uniforme Relatif au Droit Comptable et a l'Information Financiere (AUDCIF)`;

  // ─── Trial Balance ───────────────────────────────────────────────
  async trialBalancePdf(report: TrialBalanceReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();

    this.header(doc, orgName, 'Balance Générale', `Du ${report.fromDate} au ${report.toDate}`);

    const cols = [
      { label: 'Code', width: 60 },
      { label: 'Intitulé', width: 180 },
      { label: 'Débit ouv.', width: 75, align: 'right' as const },
      { label: 'Crédit ouv.', width: 75, align: 'right' as const },
      { label: 'Débit pér.', width: 75, align: 'right' as const },
      { label: 'Crédit pér.', width: 75, align: 'right' as const },
      { label: 'Solde D', width: 75, align: 'right' as const },
      { label: 'Solde C', width: 75, align: 'right' as const },
    ];

    let y = this.tableHeader(doc, cols);

    for (const row of report.rows) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
      const values = [
        row.accountCode,
        row.accountLabel,
        this.fmtAmt(row.openingDebit),
        this.fmtAmt(row.openingCredit),
        this.fmtAmt(row.periodDebit),
        this.fmtAmt(row.periodCredit),
        this.fmtAmt(row.endingDebit),
        this.fmtAmt(row.endingCredit),
      ];
      y = this.tableRow(doc, cols, values, y);
    }

    // Totals row
    const totals = report.totals;
    y = this.tableRow(
      doc,
      cols,
      [
        '',
        'TOTAUX',
        this.fmtAmt(totals.openingDebit),
        this.fmtAmt(totals.openingCredit),
        this.fmtAmt(totals.periodDebit),
        this.fmtAmt(totals.periodCredit),
        this.fmtAmt(totals.endingDebit),
        this.fmtAmt(totals.endingCredit),
      ],
      y,
      true,
    );

    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── General Ledger ──────────────────────────────────────────────
  async generalLedgerPdf(report: GeneralLedgerReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();

    this.header(
      doc,
      orgName,
      `Grand Livre — ${report.accountCode} ${report.accountLabel}`,
      `Du ${report.fromDate} au ${report.toDate}`,
    );

    const cols = [
      { label: 'Date', width: 70 },
      { label: 'Journal', width: 50 },
      { label: 'Pièce', width: 50 },
      { label: 'Libellé', width: 200 },
      { label: 'Débit', width: 80, align: 'right' as const },
      { label: 'Crédit', width: 80, align: 'right' as const },
      { label: 'Solde', width: 80, align: 'right' as const },
    ];

    let y = this.tableHeader(doc, cols);

    // Opening row
    y = this.tableRow(
      doc,
      cols,
      [
        '',
        '',
        '',
        'REPORT À NOUVEAU',
        this.fmtAmt(report.opening.openingDebit),
        this.fmtAmt(report.opening.openingCredit),
        '',
      ],
      y,
      true,
    );

    for (const line of report.lines) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
      y = this.tableRow(
        doc,
        cols,
        [
          line.entryDate,
          line.journalCode,
          String(line.entryNumber),
          (line.description ?? '').substring(0, 50),
          this.fmtAmt(line.debit),
          this.fmtAmt(line.credit),
          this.fmtAmt(line.runningBalance),
        ],
        y,
      );
    }

    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── Profit & Loss ───────────────────────────────────────────────
  async profitLossPdf(report: ProfitLossReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    const hasComparison = report.previous !== undefined;

    this.header(
      doc,
      orgName,
      'Compte de Résultat',
      `Du ${report.fromDate} au ${report.toDate}` +
        (hasComparison
          ? ` (comparaison N-1 : ${report.previous.fromDate} – ${report.previous.toDate})`
          : ''),
    );

    const cols = hasComparison
      ? [
          { label: 'Code', width: 50 },
          { label: 'Intitulé', width: 180 },
          { label: 'Montant N', width: 80, align: 'right' as const },
          { label: 'Montant N-1', width: 80, align: 'right' as const },
          { label: 'Variation', width: 70, align: 'right' as const },
          { label: '% Évol.', width: 60, align: 'right' as const },
        ]
      : [
          { label: 'Code', width: 60 },
          { label: 'Intitulé', width: 280 },
          { label: 'Montant', width: 100, align: 'right' as const },
        ];

    let y = this.tableHeader(doc, cols);

    // CHARGES
    y = this.sectionTitle(doc, 'CHARGES (Classe 6)', y);
    for (const section of report.charges) {
      y = this.plSectionRows(doc, cols, section, y, hasComparison);
    }
    const chargeValues = hasComparison
      ? [
          '',
          'TOTAL CHARGES',
          this.fmtAmt(report.totalCharges),
          this.fmtAmt(report.previous.totalCharges),
          '',
          '',
        ]
      : ['', 'TOTAL CHARGES', this.fmtAmt(report.totalCharges)];
    y = this.tableRow(doc, cols, chargeValues, y, true);

    // PRODUITS
    y = this.sectionTitle(doc, 'PRODUITS (Classe 7)', y + 10);
    for (const section of report.produits) {
      y = this.plSectionRows(doc, cols, section, y, hasComparison);
    }
    const prodValues = hasComparison
      ? [
          '',
          'TOTAL PRODUITS',
          this.fmtAmt(report.totalProduits),
          this.fmtAmt(report.previous.totalProduits),
          '',
          '',
        ]
      : ['', 'TOTAL PRODUITS', this.fmtAmt(report.totalProduits)];
    y = this.tableRow(doc, cols, prodValues, y, true);

    // Résultat
    y += 8;
    const resValues = hasComparison
      ? [
          '',
          'RÉSULTAT NET',
          this.fmtAmt(report.resultat),
          this.fmtAmt(report.previous.resultat),
          '',
          '',
        ]
      : ['', 'RÉSULTAT NET', this.fmtAmt(report.resultat)];
    y = this.tableRow(doc, cols, resValues, y, true);

    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── Balance Sheet ───────────────────────────────────────────────
  async balanceSheetPdf(report: BalanceSheetReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    const hasComparison = report.previous !== undefined;

    this.header(
      doc,
      orgName,
      'Bilan OHADA – SYSCOHADA AUDCIF',
      `Au ${report.asAtDate}` +
        (hasComparison ? ` (comparaison N-1 : ${report.previous.asAtDate})` : ''),
    );

    const cols = hasComparison
      ? [
          { label: 'Code', width: 50 },
          { label: 'Intitulé', width: 180 },
          { label: 'Montant N', width: 80, align: 'right' as const },
          { label: 'Montant N-1', width: 80, align: 'right' as const },
          { label: 'Variation', width: 70, align: 'right' as const },
          { label: '% Évol.', width: 60, align: 'right' as const },
        ]
      : [
          { label: 'Code', width: 60 },
          { label: 'Intitulé', width: 280 },
          { label: 'Montant', width: 100, align: 'right' as const },
        ];

    let y = this.tableHeader(doc, cols);

    // ACTIF
    y = this.sectionTitle(doc, 'ACTIF', y);
    for (const section of report.actif.sections) {
      y = this.bsSectionRows(doc, cols, section, y, hasComparison);
    }
    const actifTotals = hasComparison
      ? [
          '',
          'TOTAL ACTIF',
          this.fmtAmt(report.actif.total),
          this.fmtAmt(report.previous.totalActif),
          '',
          '',
        ]
      : ['', 'TOTAL ACTIF', this.fmtAmt(report.actif.total)];
    y = this.tableRow(doc, cols, actifTotals, y, true);

    // PASSIF
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = this.tableHeader(doc, cols);
    }
    y = this.sectionTitle(doc, 'PASSIF', y + 10);
    for (const section of report.passif.sections) {
      y = this.bsSectionRows(doc, cols, section, y, hasComparison);
    }
    const passifTotals = hasComparison
      ? [
          '',
          'TOTAL PASSIF',
          this.fmtAmt(report.passif.total),
          this.fmtAmt(report.previous.totalPassif),
          '',
          '',
        ]
      : ['', 'TOTAL PASSIF', this.fmtAmt(report.passif.total)];
    y = this.tableRow(doc, cols, passifTotals, y, true);

    // Difference
    y += 8;
    doc
      .font('Helvetica-Bold')
      .fontSize(ReportsPdfService.FONT_SIZE_TABLE)
      .text(
        `Écart Actif − Passif : ${this.fmtAmt(report.difference)}`,
        ReportsPdfService.MARGIN,
        y,
      );
    if (report.netResultIncorporated !== null) {
      y += ReportsPdfService.LINE_HEIGHT;
      doc.text(
        `Résultat de l'exercice incorporé dans les capitaux propres : ${this.fmtAmt(report.netResultIncorporated)}`,
        ReportsPdfService.MARGIN,
        y,
      );
    }

    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── Internal helpers ────────────────────────────────────────────

  private createDoc(): PDFKit.PDFDocument {
    return new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: ReportsPdfService.MARGIN,
      bufferPages: true,
      info: {
        Title: 'Rapport financier OHADA',
        Creator: 'ERP Compta – SYSCOHADA AUDCIF',
      },
    });
  }

  private header(doc: PDFKit.PDFDocument, orgName: string, title: string, period: string): void {
    const m = ReportsPdfService.MARGIN;
    doc.font('Helvetica-Bold').fontSize(ReportsPdfService.FONT_SIZE_HEADER).text(orgName, m, m);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(12).text(title);
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(ReportsPdfService.FONT_SIZE_SUBTITLE).text(period);
    doc.moveDown(0.2);
    doc
      .font('Helvetica-Oblique')
      .fontSize(7)
      .fillColor('#555555')
      .text(ReportsPdfService.OHADA_STAMP);
    doc.fillColor('#000000');
    doc.moveDown(0.6);
  }

  private tableHeader(
    doc: PDFKit.PDFDocument,
    cols: Array<{ label: string; width: number; align?: 'right' }>,
  ): number {
    const m = ReportsPdfService.MARGIN;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(ReportsPdfService.FONT_SIZE_TABLE);

    let x = m;
    for (const col of cols) {
      doc.text(col.label, x, y, {
        width: col.width,
        align: col.align ?? 'left',
      });
      x += col.width + ReportsPdfService.COL_GAP;
    }

    const lineY = y + ReportsPdfService.LINE_HEIGHT;
    doc
      .moveTo(m, lineY)
      .lineTo(x - ReportsPdfService.COL_GAP, lineY)
      .lineWidth(0.5)
      .stroke();

    return lineY + 4;
  }

  private tableRow(
    doc: PDFKit.PDFDocument,
    cols: Array<{ label: string; width: number; align?: 'right' }>,
    values: string[],
    y: number,
    bold = false,
  ): number {
    const m = ReportsPdfService.MARGIN;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(ReportsPdfService.FONT_SIZE_TABLE);

    let x = m;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      doc.text(values[i] ?? '', x, y, {
        width: col.width,
        align: col.align ?? 'left',
      });
      x += col.width + ReportsPdfService.COL_GAP;
    }

    return y + ReportsPdfService.LINE_HEIGHT;
  }

  private sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number): number {
    doc.font('Helvetica-Bold').fontSize(9).text(title, ReportsPdfService.MARGIN, y);
    return y + ReportsPdfService.LINE_HEIGHT + 4;
  }

  private plSectionRows(
    doc: PDFKit.PDFDocument,
    cols: Array<{ label: string; width: number; align?: 'right' }>,
    section: {
      code: string;
      label: string;
      amount: string;
      previousAmount?: string;
      variation?: string;
      variationPercent?: string | null;
      accounts: ReadonlyArray<ProfitLossAccountLine>;
    },
    y: number,
    hasComparison: boolean,
  ): number {
    // Section header row
    const sectionValues = hasComparison
      ? [
          section.code,
          section.label,
          this.fmtAmt(section.amount),
          this.fmtAmt(section.previousAmount ?? '0.00'),
          this.fmtAmt(section.variation ?? ''),
          section.variationPercent ? `${section.variationPercent}%` : '—',
        ]
      : [section.code, section.label, this.fmtAmt(section.amount)];
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = this.tableHeader(doc, cols);
    }
    y = this.tableRow(doc, cols, sectionValues, y, true);

    // Account detail rows
    for (const acc of section.accounts) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
      const accValues = hasComparison
        ? [
            acc.code,
            `  ${acc.label}`,
            this.fmtAmt(acc.amount),
            this.fmtAmt(acc.previousAmount ?? '0.00'),
            this.fmtAmt(acc.variation ?? ''),
            acc.variationPercent ? `${acc.variationPercent}%` : '—',
          ]
        : [acc.code, `  ${acc.label}`, this.fmtAmt(acc.amount)];
      y = this.tableRow(doc, cols, accValues, y);
    }
    return y;
  }

  private bsSectionRows(
    doc: PDFKit.PDFDocument,
    cols: Array<{ label: string; width: number; align?: 'right' }>,
    section: {
      key: string;
      label: string;
      groups: ReadonlyArray<BalanceSheetGroup>;
      total: string;
      previousTotal?: string;
    },
    y: number,
    hasComparison: boolean,
  ): number {
    // Section label
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = this.tableHeader(doc, cols);
    }
    const sectionValues = hasComparison
      ? [
          '',
          section.label,
          this.fmtAmt(section.total),
          this.fmtAmt(section.previousTotal ?? '0.00'),
          '',
          '',
        ]
      : ['', section.label, this.fmtAmt(section.total)];
    y = this.tableRow(doc, cols, sectionValues, y, true);

    for (const group of section.groups) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
      const gValues = hasComparison
        ? [
            group.code,
            `  ${group.label}`,
            this.fmtAmt(group.amount),
            this.fmtAmt(group.previousAmount ?? '0.00'),
            this.fmtAmt(group.variation ?? ''),
            group.variationPercent ? `${group.variationPercent}%` : '—',
          ]
        : [group.code, `  ${group.label}`, this.fmtAmt(group.amount)];
      y = this.tableRow(doc, cols, gValues, y);
    }
    return y;
  }

  private footer(doc: PDFKit.PDFDocument): void {
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#888888')
        .text(
          `Page ${i + 1} / ${pages.count}  —  Généré le ${new Date().toISOString().slice(0, 10)}  —  ERP Compta SYSCOHADA`,
          ReportsPdfService.MARGIN,
          doc.page.height - 30,
          { align: 'center', width: doc.page.width - ReportsPdfService.MARGIN * 2 },
        );
    }
    doc.fillColor('#000000');
  }

  private finalize(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  private fmtAmt(value: string | number | undefined | null): string {
    if (value === undefined || value === null || value === '') return '';
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(n)) return '';
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
