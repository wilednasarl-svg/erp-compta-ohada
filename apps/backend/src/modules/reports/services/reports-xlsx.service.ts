import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

import type {
  CashTrendReport,
  ComparativeBalanceReport,
  FinancialRatiosReport,
  MultiYearBalanceReport,
  TrialBalanceReport,
  GeneralLedgerReport,
  ProfitLossReport,
  BalanceSheetReport,
  SigReport,
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

  // ─── Comparative balance N / N-1 ─────────────────────────────────
  /**
   * Reproduces the typical Sage SYSCOHADA "Balance pluri-exercices"
   * column layout:
   *   Compte | Intitulé | Mvt N-1 D | Mvt N-1 C | Mvt N D | Mvt N C |
   *   Solde D | Solde C | Variation nette | % Évolution
   */
  comparativeBalanceXlsx(report: ComparativeBalanceReport, orgName: string): Buffer {
    const rows: unknown[][] = [];

    rows.push([orgName]);
    rows.push([
      `Balance comparative — N : ${report.fromDate} → ${report.toDate} | ` +
        `N-1 : ${report.previousFromDate} → ${report.previousToDate}`,
    ]);
    rows.push([]);

    rows.push([
      'Compte',
      'Intitulé',
      `Mvt N-1 Débit`,
      `Mvt N-1 Crédit`,
      `Mvt N Débit`,
      `Mvt N Crédit`,
      'Solde Débit',
      'Solde Crédit',
      'Variation nette',
      '% Évolution',
    ]);

    for (const r of report.rows) {
      rows.push([
        r.accountCode,
        r.accountLabel,
        this.num(r.previousPeriodDebit),
        this.num(r.previousPeriodCredit),
        this.num(r.periodDebit),
        this.num(r.periodCredit),
        this.num(r.endingDebit),
        this.num(r.endingCredit),
        this.num(r.netVariation),
        r.netVariationPercent !== null ? `${r.netVariationPercent}%` : '',
      ]);
    }

    const t = report.totals;
    rows.push([
      '',
      'TOTAUX',
      this.num(t.previousPeriodDebit),
      this.num(t.previousPeriodCredit),
      this.num(t.periodDebit),
      this.num(t.periodCredit),
      this.num(t.endingDebit),
      this.num(t.endingCredit),
      '',
      '',
    ]);

    return this.buildWorkbook(rows, 'Balance comparative');
  }

  // ─── Soldes Intermédiaires de Gestion (SIG) ──────────────────────
  /**
   * Mise en page SYSCOHADA AUDCIF : détail des postes RA→RS + TA→TO
   * suivi de la cascade XA → XI avec formules officielles. Quand
   * `previous` est présent, ajoute deux colonnes N-1 + variation.
   */
  sigXlsx(report: SigReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    const hasComp = report.previous !== undefined;

    rows.push([orgName]);
    rows.push([
      `Soldes Intermédiaires de Gestion (SIG) — Du ${report.fromDate} au ${report.toDate}` +
        (hasComp
          ? ` (comparaison : ${report.previous.fromDate} → ${report.previous.toDate})`
          : ''),
    ]);
    rows.push([]);

    const header = hasComp
      ? ['Réf.', 'Libellé', 'Montant N', 'Montant N-1', 'Variation', '% Évolution']
      : ['Réf.', 'Libellé', 'Montant N'];
    rows.push(header);

    rows.push(['', 'PRODUITS (par poste officiel)']);
    for (const p of report.produits) {
      const r = hasComp
        ? [p.code, p.label, this.num(p.amount), this.num(p.previousAmount), '', '']
        : [p.code, p.label, this.num(p.amount)];
      rows.push(r);
    }

    rows.push([]);
    rows.push(['', 'CHARGES (par poste officiel)']);
    for (const p of report.charges) {
      const r = hasComp
        ? [p.code, p.label, this.num(p.amount), this.num(p.previousAmount), '', '']
        : [p.code, p.label, this.num(p.amount)];
      rows.push(r);
    }

    rows.push([]);
    rows.push(['', 'SOLDES INTERMÉDIAIRES (cascade SYSCOHADA)']);
    for (const s of report.soldes) {
      const r = hasComp
        ? [
            s.code,
            `${s.label}  [${s.formula}]`,
            this.num(s.amount),
            this.num(s.previousAmount),
            this.num(s.variation),
            s.variationPercent !== undefined && s.variationPercent !== null
              ? `${s.variationPercent}%`
              : '',
          ]
        : [s.code, `${s.label}  [${s.formula}]`, this.num(s.amount)];
      rows.push(r);
    }

    return this.buildWorkbook(rows, 'SIG');
  }

  // ─── Balance pluri-exercices ─────────────────────────────────────
  multiYearBalanceXlsx(report: MultiYearBalanceReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    rows.push([orgName]);
    const periodsLabel = report.periods.map((p) => `${p.fromDate} → ${p.toDate}`).join(' | ');
    rows.push([`Balance pluri-exercices — ${periodsLabel}`]);
    rows.push([]);
    const header = [
      'Compte',
      'Intitulé',
      ...report.periods.map((p) => `Net ${p.fromDate.slice(0, 4)}`),
      'Solde Débit',
      'Solde Crédit',
    ];
    rows.push(header);
    for (const r of report.rows) {
      rows.push([
        r.accountCode,
        r.accountLabel,
        ...r.netByPeriod.map((n) => this.num(n)),
        this.num(r.endingDebit),
        this.num(r.endingCredit),
      ]);
    }
    return this.buildWorkbook(rows, 'Balance pluri-exercices');
  }

  // ─── Trésorerie nette glissante ──────────────────────────────────
  cashTrendXlsx(report: CashTrendReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    rows.push([orgName]);
    rows.push([`Trésorerie nette glissante — De ${report.fromMonth} à ${report.toMonth}`]);
    rows.push([]);
    rows.push([
      'Mois',
      'Date coupure',
      'Débit cumulé',
      'Crédit cumulé',
      'Trésorerie nette',
      'Variation MoM',
    ]);
    for (const p of report.points) {
      rows.push([
        p.yearMonth,
        p.asAtDate,
        this.num(p.totalDebit),
        this.num(p.totalCredit),
        this.num(p.netCash),
        p.change !== null ? this.num(p.change) : '',
      ]);
    }
    rows.push([]);
    rows.push(['', 'Trésorerie actuelle', '', '', this.num(report.currentNetCash), '']);
    rows.push(['', 'Trésorerie min sur la période', '', '', this.num(report.minNetCash), '']);
    rows.push(['', 'Trésorerie max sur la période', '', '', this.num(report.maxNetCash), '']);
    return this.buildWorkbook(rows, 'Trésorerie glissante');
  }

  // ─── Ratios financiers ───────────────────────────────────────────
  financialRatiosXlsx(report: FinancialRatiosReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    rows.push([orgName]);
    rows.push([
      `Ratios financiers — Au ${report.asAtDate} (exercice débutant le ${report.fiscalYearStartDate})`,
    ]);
    rows.push([]);
    rows.push(['Code', 'Famille', 'Libellé', 'Formule', 'Numérateur', 'Dénominateur', 'Valeur', 'Unité', 'Interprétation']);
    for (const r of report.ratios) {
      rows.push([
        r.code,
        r.category,
        r.label,
        r.formula,
        this.num(r.numerator),
        this.num(r.denominator),
        r.value !== null
          ? r.unit === 'PERCENT'
            ? `${r.value}%`
            : r.unit === 'DAYS'
              ? `${r.value} j`
              : r.value
          : 'n/a',
        r.unit,
        r.interpretation ?? '',
      ]);
    }
    return this.buildWorkbook(rows, 'Ratios financiers');
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
