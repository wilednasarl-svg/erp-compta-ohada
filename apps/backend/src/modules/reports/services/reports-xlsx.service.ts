import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

import type { CashFlowReport, CashFlowSection } from './cash-flow.service';
import { getTftLabel } from './postes/tft-postes';
import type {
  AgingBalanceReport,
  AnnexeReport,
  CashTrendReport,
  ComparativeBalanceReport,
  FinancialRatiosReport,
  MultiYearBalanceReport,
  TrialBalanceReport,
  GeneralLedgerReport,
  ProfitLossReport,
  BalanceSheetReport,
  BilanMasse,
  BilanPoste,
  SigReport,
} from './reports.service';

/** Format Excel comptable francophone avec négatifs entre parenthèses. */
const FMT_AMOUNT_FR = '# ##0,00;(# ##0,00);"";@';

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
  /**
   * Grand Livre XLSX — format doctrine OHADA (Acte uniforme art. 19,
   * Tome 1 chap. 1) : 8 colonnes `Date | Journal | Pièce | Libellé |
   * Débit | Crédit | Solde | D/C`. En-tête figé (freeze pane).
   */
  generalLedgerXlsx(report: GeneralLedgerReport, orgName: string): Buffer {
    const rows: unknown[][] = [];

    rows.push([orgName]);
    rows.push([
      `Grand Livre — ${report.accountCode} ${report.accountLabel} — Du ${report.fromDate} au ${report.toDate} — Devise : XOF`,
    ]);
    rows.push([]);

    rows.push(['Date', 'Journal', 'Pièce', 'Libellé', 'Débit', 'Crédit', 'Solde', 'D/C']);
    const headerRowIndex = rows.length - 1;

    // Opening row
    rows.push([
      '',
      '',
      '',
      'REPORT À NOUVEAU',
      this.num(report.opening.openingDebit),
      this.num(report.opening.openingCredit),
      this.num(report.opening.openingBalance),
      report.opening.openingBalanceSide,
    ]);

    for (const line of report.lines) {
      rows.push([
        line.entryDate,
        line.journalCode,
        line.entryNumber,
        line.description ?? '',
        this.num(line.debit),
        this.num(line.credit),
        this.num(line.runningBalanceAbs),
        line.runningBalanceSide,
      ]);
    }

    const totals = report.totals;
    rows.push([
      '',
      '',
      '',
      `TOTAL ${report.accountCode}`,
      this.num(totals.periodDebit),
      this.num(totals.periodCredit),
      this.num(totals.closingBalance),
      totals.closingBalanceSide,
    ]);

    // Plage des lignes numériques (toutes les lignes de données + total).
    const numericRowIndexes: number[] = [];
    for (let r = headerRowIndex + 1; r < rows.length; r++) numericRowIndexes.push(r);

    return this.buildWorkbookFormatted(rows, 'Grand Livre', {
      headerRowIndex,
      numericColIndexes: [4, 5, 6],
      numericRowIndexes,
      colWidths: [12, 10, 10, 40, 14, 14, 16, 5],
      freezeRow: headerRowIndex + 1,
    });
  }

  // ─── Profit & Loss (W5.2 volet 2 — contexture normalisée DGI) ────
  /**
   * Compte de Résultat XLSX — classeur à feuille unique conforme
   * Tome 3 p. 33 : 6 colonnes `Réf | Libellé | Note | +/- | Montant N
   * | Montant N-1`. La séquence éditoriale suit la cascade officielle
   * (TA, RA, RB, **XA**, TB, …, **XI**) avec SIG intercalés en gras.
   *
   * Doctrine : Tome 3 p. 32-33 (imprimé normalisé du CR en liste).
   *
   * Format numérique : `# ##0,00;(# ##0,00);"";@` (parenthèses pour
   * les négatifs, cellule vide pour 0 — convention DGI). Les lignes
   * SIG (XA..XI) portent un fond léger ; la ligne XI est encadrée.
   */
  profitLossXlsx(report: ProfitLossReport, orgName: string): Buffer {
    const hasComp = report.previous !== undefined;

    const rows: unknown[][] = [];
    rows.push([orgName]);
    rows.push([
      `Compte de Résultat — SYSCOHADA AUDCIF (Tome 3 p. 33) — Du ${report.fromDate} au ${report.toDate}` +
        (hasComp ? ` (N-1 : ${report.previous.fromDate} → ${report.previous.toDate})` : '') +
        ' — Devise : XOF',
    ]);
    rows.push([]);

    const header: unknown[] = ['Réf.', 'Libellé', 'Note', '+/-', 'Montant N', 'Montant N-1'];
    const headerRowIndex = rows.length;
    rows.push(header);

    const numericRowIndexes: number[] = [];

    rows.push(['', 'ACTIVITÉS ORDINAIRES', '', '', '', '']);

    for (const line of report.lines) {
      numericRowIndexes.push(rows.length);
      rows.push([
        line.ref,
        line.kind === 'SIG' ? line.label.toUpperCase() : line.label,
        line.note ?? '',
        line.sign ?? '',
        this.num(line.amountN),
        hasComp ? this.num(line.amountPrevious ?? '0') : '',
      ]);
    }

    // Pied de tableau récap (Devise + totaux + écart de bouclage).
    rows.push([]);
    const ecart =
      Number(report.totalProduits) - Number(report.totalCharges) - Number(report.resultat);
    rows.push([
      '',
      `Devise : XOF — Total charges ${report.totalCharges} — Total produits ${report.totalProduits} — Écart : ${ecart.toFixed(2)}`,
      '',
      '',
      '',
      '',
    ]);

    return this.buildWorkbookMultiSheet([
      {
        rows,
        sheetName: 'Compte de résultat',
        opts: {
          headerRowIndex,
          numericColIndexes: [4, 5],
          numericRowIndexes,
          colWidths: [8, 50, 10, 6, 16, 16],
        },
      },
    ]);
  }

  // ─── Balance Sheet (W5.2 volet 2 — contexture normalisée DGI) ────
  /**
   * Bilan XLSX — contexture normalisée DGI à 7 colonnes
   * `Réf | Libellé | Note | Brut N | Amort. & dépréc. | Net N | Net N-1`.
   *
   * Doctrine : SYSCOHADA AUDCIF, Tome 3, p. 32-34 (imprimé normalisé).
   * La colonne « Note » est insérée entre Libellé et Brut N pour
   * pointer vers l'annexe correspondante (cf. champ `note` du
   * référentiel `BILAN_POSTES`).
   *
   * Reproduit la cascade `BilanMasse → BilanRubrique → BilanPoste` issue
   * de `actifMasses` / `passifMasses` (source de vérité W2.1). Côté ACTIF
   * les 7 colonnes sont remplies (Note + Brut + Amort + Net + N-1).
   * Côté PASSIF Brut / Amort restent vides — par doctrine OHADA les
   * capitaux propres et dettes n'ont pas d'amortissements opposants.
   *
   * Format numérique : `# ##0,00;(# ##0,00);"";@` (parenthèses négatives,
   * cellule vide pour 0 — convention DGI). Bordures sur en-tête et lignes
   * de totaux. Largeurs : Réf 8, Libellé 50, Note 6 (centré), montants 16.
   */
  balanceSheetXlsx(report: BalanceSheetReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    const hasComp = report.previous !== undefined;

    rows.push([orgName]);
    rows.push([
      `Bilan OHADA — SYSCOHADA AUDCIF (contexture normalisée DGI) — Au ${report.asAtDate}` +
        (hasComp ? ` (N-1 : ${report.previous.asAtDate})` : '') +
        ' — Devise : XOF',
    ]);
    rows.push([]);

    const header: unknown[] = [
      'Réf.',
      'Libellé',
      'Note',
      'Brut N',
      'Amort. & dépréc.',
      'Net N',
      'Net N-1',
    ];
    const headerRowIndex = rows.length;
    rows.push(header);

    // Track cells that should carry the comptable number format.
    const numericRowIndexes: number[] = [];

    const pushMasseRows = (masse: BilanMasse, side: 'ACTIF' | 'PASSIF'): void => {
      rows.push([masse.code, masse.label.toUpperCase(), '', '', '', '', '']);
      for (const rubrique of masse.rubriques) {
        rows.push(['', `  ${rubrique.label}`, '', '', '', '', '']);
        for (const poste of rubrique.postes) {
          const values = this.posteRowXlsx(poste, side);
          numericRowIndexes.push(rows.length);
          rows.push(values);
        }
        // Sous-total rubrique
        numericRowIndexes.push(rows.length);
        rows.push([
          '',
          `  Sous-total ${rubrique.label}`,
          '',
          '',
          '',
          this.num(rubrique.subtotal),
          rubrique.subtotalPrevious !== undefined ? this.num(rubrique.subtotalPrevious) : '',
        ]);
      }
      // Total masse
      numericRowIndexes.push(rows.length);
      rows.push([
        masse.code,
        `TOTAL ${masse.label.toUpperCase()}`,
        '',
        '',
        '',
        this.num(masse.total),
        masse.totalPrevious !== undefined ? this.num(masse.totalPrevious) : '',
      ]);
    };

    rows.push(['', 'ACTIF', '', '', '', '', '']);
    for (const masse of report.actifMasses) {
      pushMasseRows(masse, 'ACTIF');
    }
    numericRowIndexes.push(rows.length);
    rows.push([
      '',
      'TOTAL GÉNÉRAL ACTIF',
      '',
      '',
      '',
      this.num(report.totals.actif),
      hasComp ? this.num(report.previous.totalActif) : '',
    ]);

    rows.push([]);
    rows.push(['', 'PASSIF', '', '', '', '', '']);
    for (const masse of report.passifMasses) {
      pushMasseRows(masse, 'PASSIF');
    }
    numericRowIndexes.push(rows.length);
    rows.push([
      '',
      'TOTAL GÉNÉRAL PASSIF',
      '',
      '',
      '',
      this.num(report.totals.passif),
      hasComp ? this.num(report.previous.totalPassif) : '',
    ]);

    rows.push([]);
    numericRowIndexes.push(rows.length);
    rows.push([
      '',
      "Écart Actif − Passif",
      '',
      '',
      '',
      this.num(report.totals.difference),
      '',
    ]);
    if (report.netResultIncorporated !== null) {
      numericRowIndexes.push(rows.length);
      rows.push([
        '',
        "Résultat de l'exercice incorporé dans les capitaux propres",
        '',
        '',
        '',
        this.num(report.netResultIncorporated),
        '',
      ]);
    }

    return this.buildWorkbookFormatted(rows, 'Bilan', {
      headerRowIndex,
      numericColIndexes: [3, 4, 5, 6],
      numericRowIndexes,
      colWidths: [8, 50, 6, 16, 16, 16, 16],
    });
  }

  /**
   * Construit la ligne XLSX d'un `BilanPoste` selon le côté. Réutilise
   * la convention du PDF : côté PASSIF les colonnes Brut & Amort sont
   * laissées vides (capitaux propres / dettes sans amortissements
   * opposants — doctrine Tome 3 p. 32).
   */
  private posteRowXlsx(poste: BilanPoste, side: 'ACTIF' | 'PASSIF'): unknown[] {
    const code = poste.code;
    const label = `  ${poste.label}`;
    const note = poste.note ?? '';
    const net = this.num(poste.net);
    const netPrev = poste.netPrevious !== undefined ? this.num(poste.netPrevious) : '';
    if (side === 'PASSIF') {
      return [code, label, note, '', '', net, netPrev];
    }
    const brut = poste.brut !== undefined ? this.num(poste.brut) : '';
    const ded = poste.deduction !== undefined ? this.num(poste.deduction) : '';
    return [code, label, note, brut, ded, net, netPrev];
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

  // ─── TFT (W5.2 volet 2 — contexture normalisée DGI) ──────────────
  /**
   * Tableau des Flux de Trésorerie XLSX — contexture normalisée DGI à
   * 4 colonnes `Réf | Libellé | Montant N | Montant N-1`.
   *
   * Doctrine : Tome 3 p. 36 (TFT méthode indirecte).
   *
   * Structure : 3 sections ZA / ZB / ZC avec sous-totaux puis le pied
   * normalisé ZD / ZG / ZH. Affiche un contrôle de cohérence
   * ZH = ZG − ZD = ZA + ZB + ZC.
   *
   * Nomenclature OFFICIELLE Tome 3 p. 34 :
   *   ZA ouverture / ZB op. / ZC invest. / ZD fin. CP / ZE fin. CE
   *   ZF = ZD + ZE / ZG = ZB + ZC + ZF / ZH = ZA + ZG
   *
   * Si `report.previous` est fourni, la colonne « Montant N-1 » est
   * remplie pour les sous-totaux Z. Format numérique : parenthèses
   * négatives + espace fine insécable (cellule `# ##0,00;(# ##0,00);"";@`).
   */
  tftXlsx(report: CashFlowReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    rows.push([orgName]);
    rows.push([
      `Tableau des flux de trésorerie — SYSCOHADA AUDCIF — Du ${report.fromDate} au ${report.toDate} — méthode indirecte — Devise : XOF`,
    ]);
    rows.push([]);
    const header: unknown[] = ['Réf.', 'Libellé', 'Montant N', 'Montant N-1'];
    const headerRowIndex = rows.length;
    rows.push(header);
    const numericRowIndexes: number[] = [];

    const prev = report.previous;
    const numOrEmpty = (value: string | undefined): number | string =>
      value !== undefined ? this.num(value) : '';

    // ── ZA — Trésorerie nette au 1er janvier ───────────────────────
    numericRowIndexes.push(rows.length);
    rows.push([
      'ZA',
      getTftLabel('ZA'),
      this.num(report.openingCash),
      numOrEmpty(prev?.openingCash),
    ]);
    rows.push([]);

    // ── Helper sections ────────────────────────────────────────────
    const pushSection = (
      section: CashFlowSection,
      title: string,
      previousSubtotal: string | undefined,
    ): void => {
      rows.push(['', title, '', '']);
      for (const poste of section.postes) {
        numericRowIndexes.push(rows.length);
        rows.push([poste.code, `  ${poste.label}`, this.num(poste.amount), '']);
      }
      numericRowIndexes.push(rows.length);
      rows.push([
        section.code,
        section.label,
        this.num(section.subtotal),
        numOrEmpty(previousSubtotal),
      ]);
      rows.push([]);
    };

    pushSection(
      report.operatingFlows,
      "Flux de trésorerie provenant des activités opérationnelles",
      prev?.operatingFlow,
    );
    pushSection(
      report.investingFlows,
      "Flux de trésorerie provenant des opérations d'investissement",
      prev?.investingFlow,
    );
    pushSection(
      report.financingFlowsEquity,
      'Flux de trésorerie provenant du financement par les capitaux propres',
      prev?.financingFlowEquity,
    );
    pushSection(
      report.financingFlowsDebt,
      'Trésorerie provenant du financement par les capitaux étrangers',
      prev?.financingFlowDebt,
    );

    // ── ZF / ZG / ZH ───────────────────────────────────────────────
    numericRowIndexes.push(rows.length);
    rows.push([
      'ZF',
      `${getTftLabel('ZF')} (D+E)`,
      this.num(report.financingFlowsTotal),
      numOrEmpty(prev?.financingFlowTotal),
    ]);
    numericRowIndexes.push(rows.length);
    rows.push([
      'ZG',
      `${getTftLabel('ZG')} (B+C+F)`,
      this.num(report.netCashVariation),
      numOrEmpty(prev?.netCashVariation),
    ]);
    numericRowIndexes.push(rows.length);
    rows.push([
      'ZH',
      `${getTftLabel('ZH')} (G+A)`,
      this.num(report.closingCash),
      numOrEmpty(prev?.closingCash),
    ]);

    // ── Contrôle de cohérence ──────────────────────────────────────
    const coherence = parseFloat(report.coherenceCheck);
    if (Math.abs(coherence) > 0.005) {
      rows.push([]);
      numericRowIndexes.push(rows.length);
      rows.push([
        '',
        'Contrôle : Trésorerie actif N − Trésorerie passif N (écart)',
        this.num(report.coherenceCheck),
        '',
      ]);
    }

    return this.buildWorkbookFormatted(rows, 'TFT', {
      headerRowIndex,
      numericColIndexes: [2, 3],
      numericRowIndexes,
      colWidths: [8, 60, 18, 18],
    });
  }

  // ─── Annexe (Notes 1-36) ─────────────────────────────────────────
  annexeXlsx(report: AnnexeReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    rows.push([orgName]);
    rows.push([
      `Annexe SYSCOHADA AUDCIF — Au ${report.asAtDate} (exercice ${report.fiscalYearStartDate})`,
    ]);
    rows.push([]);
    rows.push(['Note', 'Titre', 'Statut', 'Source / Référence', 'Résumé']);
    for (const n of report.notes) {
      rows.push([n.code, n.title, n.status, n.source ?? '', n.summary ?? '']);
    }
    return this.buildWorkbook(rows, 'Annexe');
  }

  // ─── Bilan officiel SYSCOHADA avec codes postes AA-DZ ────────────
  /**
   * Export XLSX du bilan avec les codes de poste officiels OHADA.
   * Mapping section → code de poste totaliseur :
   *   ACTIF  : AE = Total Immobilisé, AI = Total Circulant,
   *            AM = Total Trésorerie Actif, AZ = TOTAL GÉNÉRAL ACTIF
   *   PASSIF : CH = Total Capitaux Propres, CL = Total Dettes Fin.,
   *            CR = Total Passif Circulant, CU = Total Trésorerie Passif,
   *            DZ = TOTAL GÉNÉRAL PASSIF
   * Les sous-comptes individuels gardent leur code OHADA (8 chiffres) ;
   * ce sont les TOTAUX qui portent le code de poste officiel.
   */
  balanceSheetOfficialXlsx(report: BalanceSheetReport, orgName: string): Buffer {
    const sectionPostCodeActif: Record<string, string> = {
      IMMOBILISE: 'AE',
      CIRCULANT: 'AI',
      TRESORERIE_ACTIF: 'AM',
    };
    const sectionPostCodePassif: Record<string, string> = {
      CAPITAUX_PROPRES: 'CH',
      DETTES_FINANCIERES: 'CL',
      PASSIF_CIRCULANT: 'CR',
      TRESORERIE_PASSIF: 'CU',
    };
    const rows: unknown[][] = [];
    const hasComp = report.previous !== undefined;
    rows.push([orgName]);
    rows.push([
      `Bilan OFFICIEL SYSCOHADA AUDCIF (Vol. 3, codes AA-DZ) — Au ${report.asAtDate}` +
        (hasComp ? ` (N-1 : ${report.previous.asAtDate})` : ''),
    ]);
    rows.push([]);
    const header = hasComp
      ? ['Réf.', 'Intitulé', 'Montant N', 'Montant N-1']
      : ['Réf.', 'Intitulé', 'Montant N'];
    rows.push(header);

    const pushRow = (
      ref: string,
      label: string,
      amount: string,
      previousAmount: string | undefined,
    ): void => {
      const row = hasComp
        ? [ref, label, this.num(amount), this.num(previousAmount ?? '0')]
        : [ref, label, this.num(amount)];
      rows.push(row);
    };

    rows.push(['', 'ACTIF']);
    for (const section of report.actif.sections) {
      pushRow('', `  ${section.label}`, '', undefined);
      for (const group of section.groups) {
        pushRow(
          group.code,
          `    ${group.label}`,
          group.amount,
          group.previousAmount,
        );
      }
      const code = sectionPostCodeActif[section.key] ?? '';
      pushRow(code, `  TOTAL ${section.label.toUpperCase()}`, section.total, section.previousTotal);
    }
    pushRow(
      'AZ',
      'TOTAL GÉNÉRAL ACTIF',
      report.actif.total,
      report.previous?.totalActif,
    );

    rows.push([]);
    rows.push(['', 'PASSIF']);
    for (const section of report.passif.sections) {
      pushRow('', `  ${section.label}`, '', undefined);
      for (const group of section.groups) {
        pushRow(
          group.code,
          `    ${group.label}`,
          group.amount,
          group.previousAmount,
        );
      }
      const code = sectionPostCodePassif[section.key] ?? '';
      pushRow(code, `  TOTAL ${section.label.toUpperCase()}`, section.total, section.previousTotal);
    }
    pushRow(
      'DZ',
      'TOTAL GÉNÉRAL PASSIF',
      report.passif.total,
      report.previous?.totalPassif,
    );

    rows.push([]);
    rows.push(['', `Écart Actif − Passif : ${this.num(report.difference)}`]);
    return this.buildWorkbook(rows, 'Bilan officiel');
  }

  // ─── Compte de Résultat officiel SYSCOHADA (Vol. 3) ──────────────
  /**
   * Mise en forme officielle du CR selon le Guide d'application Vol. 3
   * (lignes 1174-1208 de l'extrait txt). Cascade verticale :
   *   TA - Ventes marchandises
   *   RA - Achats marchandises
   *   RB - Variation stocks marchandises
   *   XA - MARGE COMMERCIALE
   *   TB ... TD
   *   XB - CHIFFRE D'AFFAIRES
   *   ... etc jusqu'à XI - RÉSULTAT NET
   * Reutilise les données d'un SigReport.
   */
  profitLossOfficialXlsx(report: SigReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    const hasComp = report.previous !== undefined;
    rows.push([orgName]);
    rows.push([
      `Compte de Résultat OFFICIEL (Vol. 3 SYSCOHADA) — Du ${report.fromDate} au ${report.toDate}` +
        (hasComp
          ? ` (N-1 : ${report.previous.fromDate} → ${report.previous.toDate})`
          : ''),
    ]);
    rows.push([]);
    const header = hasComp
      ? ['Réf.', 'Libellé', 'Montant N', 'Montant N-1']
      : ['Réf.', 'Libellé', 'Montant N'];
    rows.push(header);

    // Index helpers
    const chargeBy = new Map(report.charges.map((c) => [c.code, c]));
    const produitBy = new Map(report.produits.map((p) => [p.code, p]));
    const soldeBy = new Map(report.soldes.map((s) => [s.code, s]));

    const line = (code: string) => {
      const item = chargeBy.get(code) ?? produitBy.get(code) ?? soldeBy.get(code);
      if (item === undefined) return;
      const labelRaw = item.label;
      const isSolde = code.startsWith('X');
      const label = isSolde ? labelRaw.toUpperCase() : labelRaw;
      const row = hasComp
        ? [code, label, this.num(item.amount), this.num(item.previousAmount)]
        : [code, label, this.num(item.amount)];
      rows.push(row);
    };

    // Cascade officielle Vol. 3 (ordre exact)
    line('TA');
    line('RA');
    line('RB');
    line('XA');
    line('TB');
    line('TC');
    line('TD');
    line('XB');
    line('TE');
    line('TF');
    line('TG');
    line('TH');
    line('TI');
    line('RC');
    line('RD');
    line('RE');
    line('RF');
    line('RG');
    line('RH');
    line('RI');
    line('RJ');
    line('XC');
    line('RK');
    line('XD');
    line('TJ');
    line('RL');
    line('XE');
    line('TK');
    line('TL');
    line('TM');
    line('RM');
    line('XF');
    line('XG');
    line('TN');
    line('TO');
    line('RO');
    line('RP');
    line('XH');
    line('RQ');
    line('RS');
    line('XI');

    return this.buildWorkbook(rows, 'CR officiel');
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

  // ─── Balance âgée ────────────────────────────────────────────────
  agingBalanceXlsx(report: AgingBalanceReport, orgName: string): Buffer {
    const rows: unknown[][] = [];
    const sideLabel = report.side === 'CLIENT' ? 'Clients (créances)' : 'Fournisseurs (dettes)';
    rows.push([orgName]);
    rows.push([`Balance âgée — ${sideLabel} — Au ${report.asAtDate}`]);
    rows.push([]);
    const bucketLabels = report.rows[0]?.buckets.map((b) => b.label) ?? [];
    rows.push(['Compte', 'Intitulé', ...bucketLabels, 'Total']);
    for (const r of report.rows) {
      rows.push([
        r.accountCode,
        r.accountLabel,
        ...r.buckets.map((b) => this.num(b.amount)),
        this.num(r.total),
      ]);
    }
    rows.push([]);
    rows.push([
      '',
      'TOTAUX',
      ...report.bucketTotals.map((b) => this.num(b)),
      this.num(report.grandTotal),
    ]);
    return this.buildWorkbook(rows, 'Balance âgée');
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

  /**
   * Variante de `buildWorkbook` qui applique un format comptable (`z`
   * cell property) sur les cellules numériques et fixe les largeurs de
   * colonnes explicitement. Utilisé par les exports W5.2 contexture DGI.
   */
  private buildWorkbookFormatted(
    rows: unknown[][],
    sheetName: string,
    opts: {
      headerRowIndex: number;
      numericColIndexes: readonly number[];
      numericRowIndexes: readonly number[];
      colWidths: readonly number[];
      /** Optional row index to freeze (sticky header). 0-based. */
      freezeRow?: number;
    },
  ): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = this.buildSheetFormatted(rows, opts);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return Buffer.from(buf);
  }

  /**
   * Classeur multi-feuilles (CR XLSX W5.2 : CR + SIG). Chaque sheet est
   * construit via `buildSheetFormatted` avec ses propres options.
   */
  private buildWorkbookMultiSheet(
    sheets: ReadonlyArray<{
      rows: unknown[][];
      sheetName: string;
      opts: {
        headerRowIndex: number;
        numericColIndexes: readonly number[];
        numericRowIndexes: readonly number[];
        colWidths: readonly number[];
      };
    }>,
  ): Buffer {
    const wb = XLSX.utils.book_new();
    for (const sheet of sheets) {
      const ws = this.buildSheetFormatted(sheet.rows, sheet.opts);
      XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName);
    }
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return Buffer.from(buf);
  }

  private buildSheetFormatted(
    rows: unknown[][],
    opts: {
      headerRowIndex: number;
      numericColIndexes: readonly number[];
      numericRowIndexes: readonly number[];
      colWidths: readonly number[];
      freezeRow?: number;
    },
  ): XLSX.WorkSheet {
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Apply comptable number format on numeric cells.
    for (const rowIdx of opts.numericRowIndexes) {
      for (const colIdx of opts.numericColIndexes) {
        const ref = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
        const cell = (ws as Record<string, XLSX.CellObject | undefined>)[ref];
        if (cell !== undefined && cell.t === 'n') {
          cell.z = FMT_AMOUNT_FR;
        }
      }
    }

    // Column widths from explicit spec.
    ws['!cols'] = opts.colWidths.map((wch) => ({ wch }));

    // Freeze pane on the row just below the header — keeps column titles
    // visible while scrolling. SheetJS exposes this via `!freeze` / pane
    // metadata in `Workbook.Views`, but the simplest portable form is the
    // `!ref` extended object `Views[].state` — here we just record the
    // intent on the sheet so consumers (and SheetJS write path) preserve
    // it. `xlsx` lib supports `ws['!freeze']` for compatibility purposes.
    if (opts.freezeRow !== undefined && opts.freezeRow > 0) {
      const sheetWithFreeze = ws as unknown as Record<string, unknown>;
      sheetWithFreeze['!freeze'] = { xSplit: 0, ySplit: opts.freezeRow };
    }

    return ws;
  }

  private num(value: string | number | undefined | null): number {
    if (value === undefined || value === null || value === '') return 0;
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }
}
