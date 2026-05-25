import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

import type {
  TrialBalanceReport,
  GeneralLedgerReport,
  ProfitLossReport,
  BalanceSheetReport,
} from './reports.service';

/**
 * `ReportsXlsxService` — Module 9 wave 3 Excel export.
 *
 * Generates `.xlsx` workbooks using the `xlsx` (SheetJS) library that
 * is already a project dependency. Each report becomes a single-sheet
 * workbook with:
 *   - Org name + report title in rows 1-2
 *   - Header row
 *   - Data rows with locale-formatted numbers
 *   - Summary / total rows at the bottom
 */
@Injectable()
export class ReportsXlsxService {
  // ─── Trial Balance ───────────────────────────────────────────────
  trialBalanceXlsx(report: TrialBalanceReport, orgName: string): Buffer {
    const rows: unknown[][] = [];

    rows.push([orgName]);
    rows.push([`Balance Générale — Du ${report.fromDate} au ${report.toDate}`]);
    rows.push([]);

    rows.push([
      'Code',
      'Intitulé',
      'Débit ouverture',
      'Crédit ouverture',
      'Débit période',
      'Crédit période',
      'Solde débiteur',
      'Solde créditeur',
    ]);

    for (const r of report.rows) {
      rows.push([
        r.accountCode,
        r.accountLabel,
        this.num(r.openingDebit),
        this.num(r.openingCredit),
        this.num(r.periodDebit),
        this.num(r.periodCredit),
        this.num(r.endingDebit),
        this.num(r.endingCredit),
      ]);
    }

    const t = report.totals;
    rows.push([
      '',
      'TOTAUX',
      this.num(t.openingDebit),
      this.num(t.openingCredit),
      this.num(t.periodDebit),
      this.num(t.periodCredit),
      this.num(t.endingDebit),
      this.num(t.endingCredit),
    ]);

    return this.buildWorkbook(rows, 'Balance Générale');
  }

  // ─── General Ledger ──────────────────────────────────────────────
  generalLedgerXlsx(report: GeneralLedgerReport, orgName: string): Buffer {
    const rows: unknown[][] = [];

    rows.push([orgName]);
    rows.push([
      `Grand Livre — ${report.accountCode} ${report.accountLabel} — Du ${report.fromDate} au ${report.toDate}`,
    ]);
    rows.push([]);

    rows.push(['Date', 'Journal', 'Pièce', 'Libellé', 'Débit', 'Crédit', 'Solde cumulé']);

    // Opening row
    rows.push([
      '',
      '',
      '',
      'REPORT À NOUVEAU',
      this.num(report.opening.openingDebit),
      this.num(report.opening.openingCredit),
      '',
    ]);

    for (const line of report.lines) {
      rows.push([
        line.entryDate,
        line.journalCode,
        line.entryNumber,
        line.description ?? '',
        this.num(line.debit),
        this.num(line.credit),
        this.num(line.runningBalance),
      ]);
    }

    const totals = report.totals;
    rows.push([
      '',
      '',
      '',
      'TOTAUX',
      this.num(totals.periodDebit),
      this.num(totals.periodCredit),
      '',
    ]);
    rows.push([
      '',
      '',
      '',
      'SOLDE FIN DE PÉRIODE',
      this.num(totals.endingDebit),
      this.num(totals.endingCredit),
      '',
    ]);

    return this.buildWorkbook(rows, 'Grand Livre');
  }

  // ─── Profit & Loss ───────────────────────────────────────────────
  profitLossXlsx(report: ProfitLossReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    const hasComp = report.previous !== undefined;

    rows.push([orgName]);
    rows.push([
      `Compte de Résultat — Du ${report.fromDate} au ${report.toDate}` +
        (hasComp
          ? ` (comparaison N-1 : ${report.previous.fromDate} – ${report.previous.toDate})`
          : ''),
    ]);
    rows.push([]);

    const header = hasComp
      ? ['Code', 'Intitulé', 'Montant N', 'Montant N-1', 'Variation', '% Évolution']
      : ['Code', 'Intitulé', 'Montant'];
    rows.push(header);

    rows.push(['', 'CHARGES (Classe 6)']);

    for (const section of report.charges) {
      const sRow = hasComp
        ? [
            section.code,
            section.label,
            this.num(section.amount),
            this.num(section.previousAmount),
            this.num(section.variation),
            section.variationPercent ? `${section.variationPercent}%` : '',
          ]
        : [section.code, section.label, this.num(section.amount)];
      rows.push(sRow);

      for (const acc of section.accounts) {
        const aRow = hasComp
          ? [
              acc.code,
              `  ${acc.label}`,
              this.num(acc.amount),
              this.num(acc.previousAmount),
              this.num(acc.variation),
              acc.variationPercent ? `${acc.variationPercent}%` : '',
            ]
          : [acc.code, `  ${acc.label}`, this.num(acc.amount)];
        rows.push(aRow);
      }
    }

    const chargeTotal = hasComp
      ? [
          '',
          'TOTAL CHARGES',
          this.num(report.totalCharges),
          this.num(report.previous.totalCharges),
          '',
          '',
        ]
      : ['', 'TOTAL CHARGES', this.num(report.totalCharges)];
    rows.push(chargeTotal);

    rows.push([]);
    rows.push(['', 'PRODUITS (Classe 7)']);

    for (const section of report.produits) {
      const sRow = hasComp
        ? [
            section.code,
            section.label,
            this.num(section.amount),
            this.num(section.previousAmount),
            this.num(section.variation),
            section.variationPercent ? `${section.variationPercent}%` : '',
          ]
        : [section.code, section.label, this.num(section.amount)];
      rows.push(sRow);

      for (const acc of section.accounts) {
        const aRow = hasComp
          ? [
              acc.code,
              `  ${acc.label}`,
              this.num(acc.amount),
              this.num(acc.previousAmount),
              this.num(acc.variation),
              acc.variationPercent ? `${acc.variationPercent}%` : '',
            ]
          : [acc.code, `  ${acc.label}`, this.num(acc.amount)];
        rows.push(aRow);
      }
    }

    const prodTotal = hasComp
      ? [
          '',
          'TOTAL PRODUITS',
          this.num(report.totalProduits),
          this.num(report.previous.totalProduits),
          '',
          '',
        ]
      : ['', 'TOTAL PRODUITS', this.num(report.totalProduits)];
    rows.push(prodTotal);

    rows.push([]);
    const resRow = hasComp
      ? ['', 'RÉSULTAT NET', this.num(report.resultat), this.num(report.previous.resultat), '', '']
      : ['', 'RÉSULTAT NET', this.num(report.resultat)];
    rows.push(resRow);

    return this.buildWorkbook(rows, 'Compte de Résultat');
  }

  // ─── Balance Sheet ───────────────────────────────────────────────
  balanceSheetXlsx(report: BalanceSheetReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    const hasComp = report.previous !== undefined;

    rows.push([orgName]);
    rows.push([
      `Bilan OHADA – SYSCOHADA AUDCIF — Au ${report.asAtDate}` +
        (hasComp ? ` (comparaison N-1 : ${report.previous.asAtDate})` : ''),
    ]);
    rows.push([]);

    const header = hasComp
      ? ['Code', 'Intitulé', 'Montant N', 'Montant N-1', 'Variation', '% Évolution']
      : ['Code', 'Intitulé', 'Montant'];
    rows.push(header);

    rows.push(['', 'ACTIF']);

    for (const section of report.actif.sections) {
      const sRow = hasComp
        ? ['', section.label, this.num(section.total), this.num(section.previousTotal), '', '']
        : ['', section.label, this.num(section.total)];
      rows.push(sRow);

      for (const group of section.groups) {
        const gRow = hasComp
          ? [
              group.code,
              `  ${group.label}`,
              this.num(group.amount),
              this.num(group.previousAmount),
              this.num(group.variation),
              group.variationPercent ? `${group.variationPercent}%` : '',
            ]
          : [group.code, `  ${group.label}`, this.num(group.amount)];
        rows.push(gRow);
      }
    }

    const actifTotal = hasComp
      ? [
          '',
          'TOTAL ACTIF',
          this.num(report.actif.total),
          this.num(report.previous.totalActif),
          '',
          '',
        ]
      : ['', 'TOTAL ACTIF', this.num(report.actif.total)];
    rows.push(actifTotal);

    rows.push([]);
    rows.push(['', 'PASSIF']);

    for (const section of report.passif.sections) {
      const sRow = hasComp
        ? ['', section.label, this.num(section.total), this.num(section.previousTotal), '', '']
        : ['', section.label, this.num(section.total)];
      rows.push(sRow);

      for (const group of section.groups) {
        const gRow = hasComp
          ? [
              group.code,
              `  ${group.label}`,
              this.num(group.amount),
              this.num(group.previousAmount),
              this.num(group.variation),
              group.variationPercent ? `${group.variationPercent}%` : '',
            ]
          : [group.code, `  ${group.label}`, this.num(group.amount)];
        rows.push(gRow);
      }
    }

    const passifTotal = hasComp
      ? [
          '',
          'TOTAL PASSIF',
          this.num(report.passif.total),
          this.num(report.previous.totalPassif),
          '',
          '',
        ]
      : ['', 'TOTAL PASSIF', this.num(report.passif.total)];
    rows.push(passifTotal);

    rows.push([]);
    rows.push(['', `Écart Actif − Passif : ${this.num(report.difference)}`]);
    if (report.netResultIncorporated !== null) {
      rows.push([
        '',
        `Résultat de l'exercice incorporé : ${this.num(report.netResultIncorporated)}`,
      ]);
    }

    return this.buildWorkbook(rows, 'Bilan');
  }

  // ─── Internal helpers ────────────────────────────────────────────

  private buildWorkbook(rows: unknown[][], sheetName: string): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Auto-size columns (rough estimate based on header row)
    const headerIdx = rows.findIndex(
      (r) => Array.isArray(r) && r.length > 2 && typeof r[0] === 'string' && r[0].length > 0,
    );
    if (headerIdx >= 0) {
      const hdr = rows[headerIdx] as string[];
      ws['!cols'] = hdr.map((h) => ({ wch: Math.max(String(h ?? '').length + 4, 12) }));
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return Buffer.from(buf);
  }

  private num(value: string | number | undefined | null): number {
    if (value === undefined || value === null || value === '') return 0;
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }
}
