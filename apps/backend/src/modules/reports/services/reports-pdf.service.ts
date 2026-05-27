import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import type { CashFlowReport, CashFlowSection } from './cash-flow.service';
import { getTftLabel } from './postes/tft-postes';
import type {
  AgingBalanceReport,
  BalanceSheetReport,
  BilanMasse,
  BilanPoste,
  CashTrendReport,
  FinancialRatiosReport,
  GeneralLedgerReport,
  ImportDiagnosticReport,
  ProfitLossReport,
  SigReport,
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

  // ─── Profit & Loss (W5.2 volet 2 — contexture normalisée DGI) ────
  /**
   * Compte de Résultat PDF — contexture normalisée DGI à 5 colonnes
   * (`Réf. | Libellé | Note | Montant N | Montant N-1`).
   *
   * Doctrine : SYSCOHADA AUDCIF, Tome 3 « États financiers », p. 35
   * (imprimé normalisé du Compte de résultat « en liste ») + p. 18
   * (« reproduire à l'identique la contexture des imprimés normalisés »).
   *
   * Structure (Tome 3 p. 35) :
   *   1. Activités ordinaires — charges (classes 60-68) + produits (70-79)
   *      hors HAO, présentés section par section avec sous-totaux.
   *   2. Hors activités ordinaires — produits HAO (TN/TO ↔ classes 82/84/86/88),
   *      charges HAO (RO/RP ↔ 81/83/85). Les classes 6 et 7 du report
   *      les rattachent aux sections 60-89 et 70-79 — on les laisse
   *      apparaître dans la même cascade puis on synthétise la frontière.
   *   3. Cascade SIG — encadré séparé sous le CR principal, listant les
   *      9 SIG XA à XI avec leur FORMULE doctrinale (PL_POSTES). Comme
   *      `ProfitLossReport` ne porte que totalCharges / totalProduits /
   *      resultat (pas la cascade détaillée), on remplit XI = resultat
   *      et on indique « n.c. » (non communiqué) pour les autres SIG —
   *      ils sont disponibles via l'endpoint `/sig` dédié.
   *
   * Format numérique : `1 234 567,89` espace fine insécable U+202F,
   * lignes négatives entre parenthèses `(1 234,56)` au lieu du signe
   * `-` (convention comptable francophone).
   */
  async profitLossPdf(report: ProfitLossReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    const hasComparison = report.previous !== undefined;

    this.header(
      doc,
      orgName,
      'Compte de Résultat — SYSCOHADA AUDCIF (contexture normalisée DGI)',
      `Exercice du ${report.fromDate} au ${report.toDate}` +
        (hasComparison
          ? ` — comparaison N-1 : ${report.previous.fromDate} → ${report.previous.toDate}`
          : '') +
        ' — Devise : XOF',
    );

    // Colonnes Tome 3 p. 33 : Réf. | Libellé | Note | +/- | Montant N | Montant N-1.
    const cols = [
      { label: 'Réf.', width: 36 },
      { label: 'Libellé', width: 240 },
      { label: 'Note', width: 44, align: 'right' as const },
      { label: '+/-', width: 30, align: 'center' as const },
      { label: 'Montant N', width: 100, align: 'right' as const },
      { label: 'Montant N-1', width: 100, align: 'right' as const },
    ];

    let y = this.tableHeader(doc, cols);

    // ── ACTIVITÉS ORDINAIRES (SIG XA..XG intercalés en cascade) ──
    y = this.sectionTitle(doc, 'ACTIVITÉS ORDINAIRES', y);
    for (const line of report.lines) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
      y = this.crDoctrinalRow(doc, cols, line, y, hasComparison);
    }

    // ── Pied : devise + récap totaux + écart de bouclage ──
    y += 10;
    const ecart =
      Number(report.totalProduits) - Number(report.totalCharges) - Number(report.resultat);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#555555')
      .text(
        `Devise : XOF — Total charges : ${this.fmtPar(report.totalCharges)} — Total produits : ${this.fmtPar(report.totalProduits)} — Écart Produits − Charges − Résultat : ${this.fmtPar(ecart.toFixed(2))}`,
        ReportsPdfService.MARGIN,
        y,
      );
    doc.fillColor('#000000');

    this.footer(doc);
    return this.finalize(doc);
  }

  /**
   * Rendu d'une ligne doctrinale (poste lettré ou SIG intercalé) au
   * format Tome 3 p. 33. Les SIG (XA..XI) sont mis en gras avec une
   * légère bordure haute pour matérialiser la ligne de cascade ; la
   * ligne XI (résultat net) est en outre encadrée (border-around).
   */
  private crDoctrinalRow(
    doc: PDFKit.PDFDocument,
    cols: Array<{ label: string; width: number; align?: 'right' | 'center' }>,
    line: { ref: string; label: string; note?: string; sign?: string; kind: string; amountN: string; amountPrevious?: string },
    y: number,
    hasComparison: boolean,
  ): number {
    const isSig = line.kind === 'SIG';
    const isXi = line.ref === 'XI';
    const rowH = ReportsPdfService.LINE_HEIGHT;
    const m = ReportsPdfService.MARGIN;
    const totalWidth = cols.reduce((s, c) => s + c.width + ReportsPdfService.COL_GAP, 0);

    // Fond gris léger pour les SIG (cellule entière, rendu doux).
    if (isSig) {
      doc.save();
      doc.rect(m - 2, y - 2, totalWidth, rowH + 2).fill('#F3F3F3');
      doc.restore();
    }

    const values = [
      line.ref,
      isSig ? line.label.toUpperCase() : line.label,
      line.note ?? '',
      line.sign ?? '',
      this.fmtPar(line.amountN),
      hasComparison ? this.fmtPar(line.amountPrevious ?? '0') : '',
    ];
    const yAfter = this.tableRow(doc, cols, values, y, isSig);

    // Encadrement de la ligne XI (résultat net).
    if (isXi) {
      doc
        .lineWidth(0.8)
        .strokeColor('#000000')
        .rect(m - 2, y - 2, totalWidth, rowH + 2)
        .stroke();
    }
    return yAfter;
  }

  // ─── Balance Sheet (W5.2 — contexture normalisée DGI) ────────────
  /**
   * Bilan PDF — contexture normalisée DGI à 4 colonnes pour l'ACTIF
   * (Brut N | Amort. & dépréc. N | Net N | Net N-1) et 2 colonnes pour
   * le PASSIF (Net N | Net N-1).
   *
   * Doctrine : SYSCOHADA AUDCIF, Tome 3 « États financiers », p. 32-34
   * (imprimés normalisés) + p. 18 (« reproduire à l'identique la
   * contexture des imprimés normalisés »).
   *
   * Source de vérité : hiérarchie `actifMasses` / `passifMasses` issue
   * de `buildBilanHierarchy` (W2.1). Chaque `BilanPoste` expose déjà
   * `brut` / `deduction` / `net` / `netPrevious`, donc aucune ré-agrégation
   * côté PDF — le rendu se contente de mapper.
   *
   * Présentation : 3 niveaux affichés
   *   1. Masse        (gras, fond léger — ex. « AZ TOTAL ACTIF IMMOBILISÉ »)
   *   2. Rubrique     (gras italique — ex. « Actif immobilisé »)
   *   3. Poste lettré (normal indenté — ex. « AE Frais de développement »)
   *
   * Devise : XOF par défaut (affichée dans le sous-titre). Les montants
   * sont formatés `1 234 567,89` avec espace fine insécable U+202F comme
   * séparateur de milliers (conforme PRODUCT.md).
   */
  async balanceSheetPdf(report: BalanceSheetReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    const hasComparison = report.previous !== undefined;

    this.header(
      doc,
      orgName,
      'Bilan OHADA – SYSCOHADA AUDCIF (contexture normalisée DGI)',
      `Au ${report.asAtDate}` +
        (hasComparison ? ` (comparaison N-1 : ${report.previous.asAtDate})` : '') +
        ' — Devise : XOF',
    );

    // Colonnes ACTIF (4 colonnes montant + Note) — utilisées aussi pour
    // le PASSIF, où les colonnes Brut / Amort restent vides (sans objet
    // pour les capitaux propres et les dettes). La colonne « Note » est
    // insérée entre Libellé et Brut N conformément à la doctrine Tome 3
    // p. 32 (renvoie vers l'annexe correspondante).
    const cols = [
      { label: 'Réf.', width: 36 },
      { label: 'Libellé', width: 214 },
      { label: 'Note', width: 30, align: 'center' as const },
      { label: 'Brut N', width: 88, align: 'right' as const },
      { label: 'Amort. & dépréc.', width: 96, align: 'right' as const },
      { label: 'Net N', width: 88, align: 'right' as const },
      { label: 'Net N-1', width: 88, align: 'right' as const },
    ];

    let y = this.tableHeader(doc, cols);

    // ── ACTIF — 4 colonnes pleines (Brut / Amort / Net N / Net N-1) ──
    y = this.sectionTitle(doc, 'ACTIF', y);
    for (const masse of report.actifMasses) {
      y = this.bsMasseRows(doc, cols, masse, y, 'ACTIF');
    }

    // Total général ACTIF (masse racine BZ déjà rendue ci-dessus, on
    // ajoute un rappel synthétique pour faciliter la lecture).
    y = this.tableRow(
      doc,
      cols,
      [
        '',
        'TOTAL GÉNÉRAL ACTIF',
        '',
        '',
        '',
        this.fmtAmt(report.totals.actif),
        hasComparison ? this.fmtAmt(report.previous.totalActif) : '',
      ],
      y,
      true,
    );

    // ── PASSIF — 2 colonnes utiles (Brut / Amort vides par doctrine) ──
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = this.tableHeader(doc, cols);
    }
    y = this.sectionTitle(doc, 'PASSIF', y + 10);
    for (const masse of report.passifMasses) {
      y = this.bsMasseRows(doc, cols, masse, y, 'PASSIF');
    }
    y = this.tableRow(
      doc,
      cols,
      [
        '',
        'TOTAL GÉNÉRAL PASSIF',
        '',
        '',
        '',
        this.fmtAmt(report.totals.passif),
        hasComparison ? this.fmtAmt(report.previous.totalPassif) : '',
      ],
      y,
      true,
    );

    // ── Pied : équilibre + résultat incorporé ──
    y += 8;
    doc
      .font('Helvetica-Bold')
      .fontSize(ReportsPdfService.FONT_SIZE_TABLE)
      .text(
        `Écart Actif − Passif : ${this.fmtAmt(report.totals.difference)}`,
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

  /**
   * Rendu d'une masse (AZ, BJ, BK, BT, BZ, CP, DD, DF, DP, DT, DZ…)
   * avec ses rubriques et postes. Insère un saut de page si nécessaire
   * avant chaque ligne.
   *
   * Pour le côté ACTIF : affiche Brut + Amort & dépréc. + Net N + Net N-1.
   * Pour le côté PASSIF : Brut / Amort restent vides (les capitaux
   * propres et dettes n'ont pas d'amortissements opposants par
   * doctrine OHADA).
   */
  private bsMasseRows(
    doc: PDFKit.PDFDocument,
    cols: Array<{
      label: string;
      width: number;
      align?: 'right' | 'center';
    }>,
    masse: BilanMasse,
    y: number,
    side: 'ACTIF' | 'PASSIF',
  ): number {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = this.tableHeader(doc, cols);
    }

    // Header de la masse (gras, sans montant — celui-ci apparaît en
    // ligne de total après les rubriques).
    y = this.tableRow(
      doc,
      cols,
      [masse.code, masse.label.toUpperCase(), '', '', '', '', ''],
      y,
      true,
    );

    for (const rubrique of masse.rubriques) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
      // Rubrique — étiquette éditoriale (gras, indentée).
      y = this.tableRow(
        doc,
        cols,
        ['', `  ${rubrique.label}`, '', '', '', '', ''],
        y,
        true,
      );

      // Postes lettrés — par doctrine on AFFICHE même les lignes vides
      // (contexture normalisée DGI inclut tous les postes, A/N/A possible).
      for (const poste of rubrique.postes) {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = this.tableHeader(doc, cols);
        }
        y = this.tableRow(doc, cols, this.posteValues(poste, side), y);
      }

      // Sous-total de rubrique.
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
      y = this.tableRow(
        doc,
        cols,
        [
          '',
          `  Sous-total ${rubrique.label}`,
          '',
          '',
          '',
          this.fmtAmt(rubrique.subtotal),
          rubrique.subtotalPrevious !== undefined
            ? this.fmtAmt(rubrique.subtotalPrevious)
            : '',
        ],
        y,
        true,
      );
    }

    // Total de masse (ex. AZ, BJ, BT).
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = this.tableHeader(doc, cols);
    }
    y = this.tableRow(
      doc,
      cols,
      [
        masse.code,
        `TOTAL ${masse.label.toUpperCase()}`,
        '',
        '',
        '',
        this.fmtAmt(masse.total),
        masse.totalPrevious !== undefined ? this.fmtAmt(masse.totalPrevious) : '',
      ],
      y,
      true,
    );

    return y;
  }

  /**
   * Construit les 6 cellules d'une ligne de poste lettré. Côté ACTIF :
   * 4 colonnes montant (Brut / Amort / Net N / Net N-1). Côté PASSIF :
   * Brut & Amort restent vides — les capitaux propres et les dettes
   * n'ont pas de valeur brute distincte du net (Tome 3 p. 32, colonne
   * unique côté passif).
   */
  private posteValues(poste: BilanPoste, side: 'ACTIF' | 'PASSIF'): string[] {
    const code = poste.code;
    const label = `  ${poste.label}`;
    const note = poste.note ?? '';
    const netN = this.fmtAmt(poste.net);
    const netN1 =
      poste.netPrevious !== undefined ? this.fmtAmt(poste.netPrevious) : '';
    if (side === 'PASSIF') {
      return [code, label, note, '', '', netN, netN1];
    }
    const brut = poste.brut !== undefined ? this.fmtAmt(poste.brut) : '';
    const ded = poste.deduction !== undefined ? this.fmtAmt(poste.deduction) : '';
    return [code, label, note, brut, ded, netN, netN1];
  }

  // ─── Internal helpers ────────────────────────────────────────────

  // ─── SIG (Soldes Intermédiaires de Gestion) ──────────────────────
  async sigPdf(report: SigReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    const hasComp = report.previous !== undefined;
    this.header(
      doc,
      orgName,
      'Soldes Intermédiaires de Gestion (SIG)',
      `Du ${report.fromDate} au ${report.toDate}` +
        (hasComp ? ` — N-1 : ${report.previous.fromDate} → ${report.previous.toDate}` : ''),
    );
    const cols = hasComp
      ? [
          { label: 'Réf.', width: 50 },
          { label: 'Libellé', width: 350 },
          { label: 'Montant N', width: 100, align: 'right' as const },
          { label: 'Montant N-1', width: 100, align: 'right' as const },
          { label: '% Évol.', width: 60, align: 'right' as const },
        ]
      : [
          { label: 'Réf.', width: 50 },
          { label: 'Libellé', width: 450 },
          { label: 'Montant N', width: 100, align: 'right' as const },
        ];
    let y = this.tableHeader(doc, cols);
    y = this.sectionTitle(doc, 'PRODUITS', y);
    for (const p of report.produits) {
      if (Number(p.amount) < 0.005 && (!hasComp || Number(p.previousAmount ?? '0') < 0.005)) continue;
      y = this.tableRow(
        doc,
        cols,
        hasComp
          ? [p.code, p.label, this.fmtAmt(p.amount), this.fmtAmt(p.previousAmount), '']
          : [p.code, p.label, this.fmtAmt(p.amount)],
        y,
      );
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
    }
    y = this.sectionTitle(doc, 'CHARGES', y);
    for (const c of report.charges) {
      if (Number(c.amount) < 0.005 && (!hasComp || Number(c.previousAmount ?? '0') < 0.005)) continue;
      y = this.tableRow(
        doc,
        cols,
        hasComp
          ? [c.code, c.label, this.fmtAmt(c.amount), this.fmtAmt(c.previousAmount), '']
          : [c.code, c.label, this.fmtAmt(c.amount)],
        y,
      );
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
    }
    y = this.sectionTitle(doc, 'SOLDES INTERMÉDIAIRES (cascade XA → XI)', y);
    for (const s of report.soldes) {
      const pct = s.variationPercent ?? '';
      y = this.tableRow(
        doc,
        cols,
        hasComp
          ? [s.code, `${s.label}  [${s.formula}]`, this.fmtAmt(s.amount), this.fmtAmt(s.previousAmount), pct === '' ? '' : `${pct}%`]
          : [s.code, `${s.label}  [${s.formula}]`, this.fmtAmt(s.amount)],
        y,
        true,
      );
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
    }
    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── Ratios financiers ───────────────────────────────────────────
  async financialRatiosPdf(report: FinancialRatiosReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    this.header(
      doc,
      orgName,
      'Ratios financiers',
      `Au ${report.asAtDate} — Exercice débutant le ${report.fiscalYearStartDate}`,
    );
    const cols = [
      { label: 'Code', width: 50 },
      { label: 'Famille', width: 100 },
      { label: 'Ratio', width: 200 },
      { label: 'Formule', width: 250 },
      { label: 'Valeur', width: 80, align: 'right' as const },
      { label: 'Interprétation', width: 130 },
    ];
    let y = this.tableHeader(doc, cols);
    for (const r of report.ratios) {
      const v =
        r.value === null
          ? '—'
          : r.unit === 'PERCENT'
            ? `${r.value} %`
            : r.unit === 'DAYS'
              ? `${r.value} j`
              : r.value;
      y = this.tableRow(
        doc,
        cols,
        [r.code, r.category, r.label, r.formula, v, r.interpretation ?? ''],
        y,
      );
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
    }
    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── Balance âgée ────────────────────────────────────────────────
  async agingBalancePdf(report: AgingBalanceReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    const sideLabel = report.side === 'CLIENT' ? 'Clients (créances)' : 'Fournisseurs (dettes)';
    this.header(doc, orgName, `Balance âgée — ${sideLabel}`, `Au ${report.asAtDate}`);
    const bucketLabels = report.rows[0]?.buckets.map((b) => b.label) ?? [];
    const bucketWidth = Math.max(60, Math.floor(420 / Math.max(bucketLabels.length, 1)));
    const cols = [
      { label: 'Compte', width: 70 },
      { label: 'Intitulé', width: 200 },
      ...bucketLabels.map((lab) => ({ label: lab, width: bucketWidth, align: 'right' as const })),
      { label: 'Total', width: 90, align: 'right' as const },
    ];
    let y = this.tableHeader(doc, cols);
    for (const row of report.rows) {
      const values = [
        row.accountCode,
        row.accountLabel,
        ...row.buckets.map((b) => this.fmtAmt(b.amount)),
        this.fmtAmt(row.total),
      ];
      y = this.tableRow(doc, cols, values, y);
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
    }
    const totalsRow = [
      '',
      'TOTAUX',
      ...report.bucketTotals.map((b) => this.fmtAmt(b)),
      this.fmtAmt(report.grandTotal),
    ];
    y = this.tableRow(doc, cols, totalsRow, y, true);
    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── Trésorerie nette glissante ──────────────────────────────────
  async cashTrendPdf(report: CashTrendReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    this.header(
      doc,
      orgName,
      'Trésorerie nette glissante',
      `De ${report.fromMonth} à ${report.toMonth}`,
    );
    const cols = [
      { label: 'Mois', width: 70 },
      { label: 'Coupure', width: 100 },
      { label: 'Débit cumulé', width: 110, align: 'right' as const },
      { label: 'Crédit cumulé', width: 110, align: 'right' as const },
      { label: 'Trésorerie nette', width: 130, align: 'right' as const },
      { label: 'Variation MoM', width: 110, align: 'right' as const },
    ];
    let y = this.tableHeader(doc, cols);
    for (const p of report.points) {
      y = this.tableRow(
        doc,
        cols,
        [
          p.yearMonth,
          p.asAtDate,
          this.fmtAmt(p.totalDebit),
          this.fmtAmt(p.totalCredit),
          this.fmtAmt(p.netCash),
          p.change !== null ? this.fmtAmt(p.change) : '',
        ],
        y,
      );
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
    }
    y += 10;
    y = this.tableRow(doc, cols, ['', 'Trésorerie actuelle', '', '', this.fmtAmt(report.currentNetCash), ''], y, true);
    y = this.tableRow(doc, cols, ['', 'Trésorerie min', '', '', this.fmtAmt(report.minNetCash), ''], y, true);
    y = this.tableRow(doc, cols, ['', 'Trésorerie max', '', '', this.fmtAmt(report.maxNetCash), ''], y, true);
    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── TFT (B1 — nouvelle nomenclature Tome 3 p. 34) ───────────────
  /**
   * Tableau des Flux de Trésorerie PDF — contexture normalisée DGI à 5
   * colonnes (`Réf. | Libellé | Note | Montant N | Montant N-1`).
   *
   * Doctrine : SYSCOHADA AUDCIF, Tome 3 « États financiers », p. 34
   * (imprimé normalisé du TFT « méthode indirecte »).
   *
   * Nomenclature OFFICIELLE des codes Z :
   *   - ZA  Trésorerie nette au 1er janvier (ouverture)
   *   - ZB  Flux opérationnels (FA-FE)
   *   - ZC  Flux d'investissement (FF-FJ)
   *   - ZD  Flux de financement par capitaux propres (FK-FN)
   *   - ZE  Flux de financement par capitaux étrangers (FO-FQ)
   *   - ZF  Flux de financement total (= ZD + ZE)
   *   - ZG  Variation totale de la trésorerie (= ZB + ZC + ZF)
   *   - ZH  Trésorerie nette au 31 décembre (= ZA + ZG)
   *
   * Si `report.previous` est fourni, la colonne « Montant N-1 » est
   * remplie pour les sous-totaux (postes de détail non comparés). La
   * cohérence est contrôlée via `coherenceCheck`.
   * Devise : XOF. Négatifs entre parenthèses.
   */
  async tftPdf(report: CashFlowReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    this.header(
      doc,
      orgName,
      'Tableau des flux de trésorerie',
      `Exercice du ${report.fromDate} au ${report.toDate} — méthode indirecte — Devise : XOF`,
    );
    const cols = [
      { label: 'Réf.', width: 50 },
      { label: 'Libellé', width: 360 },
      { label: 'Note', width: 40, align: 'right' as const },
      { label: 'Montant N', width: 110, align: 'right' as const },
      { label: 'Montant N-1', width: 110, align: 'right' as const },
    ];
    let y = this.tableHeader(doc, cols);

    const prev = report.previous;
    const ensureSpace = (rowsAhead: number): void => {
      const need = rowsAhead * ReportsPdfService.LINE_HEIGHT + 20;
      if (y > doc.page.height - need) {
        doc.addPage();
        y = this.tableHeader(doc, cols);
      }
    };

    // ── ZA — Trésorerie nette au 1er janvier ───────────────────────
    ensureSpace(2);
    y = this.tableRow(
      doc,
      cols,
      [
        'ZA',
        getTftLabel('ZA'),
        '',
        this.fmtPar(report.openingCash),
        prev !== undefined ? this.fmtPar(prev.openingCash) : '',
      ],
      y,
      true,
    );

    // ── Helper de rendu d'une section ──────────────────────────────
    const renderSection = (
      section: CashFlowSection,
      title: string,
      previousSubtotal: string | undefined,
    ): void => {
      ensureSpace(section.postes.length + 3);
      y = this.sectionTitle(doc, title, y);
      for (const poste of section.postes) {
        ensureSpace(1);
        y = this.tableRow(
          doc,
          cols,
          [poste.code, `  ${poste.label}`, '', this.fmtPar(poste.amount), ''],
          y,
        );
      }
      ensureSpace(1);
      y = this.tableRow(
        doc,
        cols,
        [
          section.code,
          section.label,
          '',
          this.fmtPar(section.subtotal),
          previousSubtotal !== undefined ? this.fmtPar(previousSubtotal) : '',
        ],
        y,
        true,
      );
    };

    renderSection(
      report.operatingFlows,
      "Flux de trésorerie provenant des activités opérationnelles",
      prev?.operatingFlow,
    );
    renderSection(
      report.investingFlows,
      "Flux de trésorerie provenant des opérations d'investissement",
      prev?.investingFlow,
    );
    renderSection(
      report.financingFlowsEquity,
      'Flux de trésorerie provenant du financement par les capitaux propres',
      prev?.financingFlowEquity,
    );
    renderSection(
      report.financingFlowsDebt,
      'Trésorerie provenant du financement par les capitaux étrangers',
      prev?.financingFlowDebt,
    );

    // ── ZF — financement total (= ZD + ZE) ─────────────────────────
    ensureSpace(4);
    y = this.tableRow(
      doc,
      cols,
      [
        'ZF',
        `${getTftLabel('ZF')} (D+E)`,
        '',
        this.fmtPar(report.financingFlowsTotal),
        prev !== undefined ? this.fmtPar(prev.financingFlowTotal) : '',
      ],
      y,
      true,
    );

    // ── ZG — variation nette (= ZB + ZC + ZF) ──────────────────────
    y = this.tableRow(
      doc,
      cols,
      [
        'ZG',
        `${getTftLabel('ZG')} (B+C+F)`,
        '',
        this.fmtPar(report.netCashVariation),
        prev !== undefined ? this.fmtPar(prev.netCashVariation) : '',
      ],
      y,
      true,
    );

    // ── ZH — trésorerie nette au 31 décembre (= ZA + ZG) ───────────
    y = this.tableRow(
      doc,
      cols,
      [
        'ZH',
        `${getTftLabel('ZH')} (G+A)`,
        '',
        this.fmtPar(report.closingCash),
        prev !== undefined ? this.fmtPar(prev.closingCash) : '',
      ],
      y,
      true,
    );

    // ── Pied : contrôle de cohérence ───────────────────────────────
    const coherence = parseFloat(report.coherenceCheck);
    if (Math.abs(coherence) > 0.005) {
      y += 6;
      ensureSpace(2);
      doc.font('Helvetica-Oblique').fontSize(7).fillColor('#555555');
      doc.text(
        `Contrôle : Trésorerie actif N − Trésorerie passif N — écart ${this.fmtPar(report.coherenceCheck)} FCFA`,
        ReportsPdfService.MARGIN,
        y,
      );
      y += ReportsPdfService.LINE_HEIGHT;
      doc.fillColor('#000000');
    }

    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── Diagnostic d'import ────────────────────────────────────────────
  async importDiagnosticPdf(report: ImportDiagnosticReport, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();

    const sessionLabel =
      report.session.label !== null && report.session.label !== ''
        ? report.session.label
        : `Session ${report.session.id.slice(0, 8)}`;
    const docType = report.session.documentType !== null ? ` · ${report.session.documentType}` : '';
    this.header(
      doc,
      orgName,
      "Diagnostic d'import — Rapport de conformité",
      `${sessionLabel}${docType} · ${report.session.totalLines} lignes · statut ${report.session.status}`,
    );

    // ── Verdict bandeau (rectangle coloré) ──
    const verdictColors: Record<
      'conforme' | 'à corriger' | 'bloquant',
      { bg: string; border: string; text: string }
    > = {
      conforme: { bg: '#ECFDF5', border: '#10B981', text: '#065F46' },
      'à corriger': { bg: '#FFFBEB', border: '#F59E0B', text: '#92400E' },
      bloquant: { bg: '#FEF2F2', border: '#EF4444', text: '#991B1B' },
    };
    const palette = verdictColors[report.verdict.status];
    const verdictY = doc.y;
    const verdictHeight = 55;
    const pageWidth = doc.page.width - ReportsPdfService.MARGIN * 2;
    doc
      .rect(ReportsPdfService.MARGIN, verdictY, pageWidth, verdictHeight)
      .fillAndStroke(palette.bg, palette.border);
    doc.fillColor(palette.text);
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(
        `VERDICT : ${report.verdict.status.toUpperCase()}`,
        ReportsPdfService.MARGIN + 10,
        verdictY + 8,
      );
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        `${report.verdict.criticalCount} anomalie(s) critique(s) · ${report.verdict.warningCount} avertissement(s) · ${report.verdict.infoCount} info(s)`,
        ReportsPdfService.MARGIN + 10,
        verdictY + 26,
      );
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .text(
        report.verdict.canCommit
          ? "✓ Le fichier peut être commite en l'etat. Les avertissements ne sont pas bloquants."
          : "✗ Le fichier ne peut PAS etre commite. Corriger les anomalies critiques listees plus bas avant de re-tenter.",
        ReportsPdfService.MARGIN + 10,
        verdictY + 40,
      );
    doc.fillColor('#000000');
    doc.y = verdictY + verdictHeight + 12;

    // ── Totaux globaux ──
    const eqStatus = report.totals.isBalanced
      ? 'EQUILIBRE'
      : `DESEQUILIBRE de ${this.fmtAmt(report.totals.balanceDelta)}`;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(
        `Total debit : ${this.fmtAmt(report.totals.totalDebit)}  |  Total credit : ${this.fmtAmt(report.totals.totalCredit)}  |  ${eqStatus}`,
        ReportsPdfService.MARGIN,
        doc.y,
      );
    doc.moveDown(0.8);

    // ── Balance des comptes ──
    if (report.trialBalance.length > 0) {
      doc.font('Helvetica-Bold').fontSize(10).text('Balance des comptes (previsionnelle)');
      doc.moveDown(0.3);
      const balCols = [
        { label: 'Compte', width: 60 },
        { label: 'Libelle', width: 280 },
        { label: 'Lignes', width: 50, align: 'right' as const },
        { label: 'Debit', width: 90, align: 'right' as const },
        { label: 'Credit', width: 90, align: 'right' as const },
        { label: 'Solde', width: 90, align: 'right' as const },
        { label: 'Statut', width: 90 },
      ];
      let y = this.tableHeader(doc, balCols);
      for (const row of report.trialBalance) {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = this.tableHeader(doc, balCols);
        }
        const statut = row.accountExists
          ? 'existant'
          : row.autoProvisionable
            ? 'auto-cree'
            : 'inconnu';
        y = this.tableRow(
          doc,
          balCols,
          [
            row.accountCode,
            row.accountLabel,
            String(row.lineCount),
            this.fmtAmt(row.debit),
            this.fmtAmt(row.credit),
            `${this.fmtAmt(row.balance)} ${row.sign}`,
            statut,
          ],
          y,
        );
      }
      // Totaux row
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = this.tableHeader(doc, balCols);
      }
      y = this.tableRow(
        doc,
        balCols,
        [
          '',
          'TOTAUX',
          '',
          this.fmtAmt(report.totals.totalDebit),
          this.fmtAmt(report.totals.totalCredit),
          report.totals.isBalanced ? 'equilibre' : this.fmtAmt(report.totals.balanceDelta),
          '',
        ],
        y,
        true,
      );
      doc.y = y + 6;
    }

    // ── Anomalies ──
    const renderAnomalies = (
      title: string,
      groups: ImportDiagnosticReport['anomalies']['critical'],
      accent: string,
    ): void => {
      if (groups.length === 0) return;
      if (doc.y > doc.page.height - 100) doc.addPage();
      doc.moveDown(0.5);
      doc.fillColor(accent).font('Helvetica-Bold').fontSize(10).text(title);
      doc.fillColor('#000000');
      doc.moveDown(0.2);
      for (const g of groups) {
        if (doc.y > doc.page.height - 80) doc.addPage();
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(`• ${g.title} (${g.count} ligne${g.count > 1 ? 's' : ''})`);
        doc.font('Helvetica').fontSize(8).text(g.description, { indent: 12 });
        if (g.samples.length > 0) {
          doc
            .font('Helvetica-Oblique')
            .fontSize(7)
            .fillColor('#555555')
            .text(`Exemples (${g.samples.length}/${g.count}) :`, { indent: 12 });
          for (const s of g.samples.slice(0, 3)) {
            const acct = s.accountCode !== null ? ` · compte ${s.accountCode}` : '';
            const field = s.field !== undefined ? ` · champ ${s.field}` : '';
            doc.text(`  Ligne ${s.rowNumber}${acct}${field} — ${s.message}`, { indent: 16 });
          }
          doc.fillColor('#000000');
        }
        doc.moveDown(0.3);
      }
    };
    renderAnomalies('Anomalies bloquantes', report.anomalies.critical, '#991B1B');
    renderAnomalies('Avertissements', report.anomalies.warnings, '#92400E');
    renderAnomalies('Informations', report.anomalies.info, '#1F2937');

    // ── Plan de normalisation ──
    if (report.remediationPlan.length > 0) {
      if (doc.y > doc.page.height - 100) doc.addPage();
      doc.moveDown(0.5);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('Plan de normalisation — actions a entreprendre');
      doc.moveDown(0.3);
      for (const item of report.remediationPlan) {
        if (doc.y > doc.page.height - 60) doc.addPage();
        const autoTag = item.autoFixable ? ' [auto-fix]' : '';
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(
            `P${item.priority} · ${item.title}${autoTag} (${item.affectedCount} ligne${item.affectedCount > 1 ? 's' : ''})`,
          );
        doc.font('Helvetica').fontSize(8).text(item.description, { indent: 12 });
        doc.moveDown(0.3);
      }
    }

    this.footer(doc);
    return this.finalize(doc);
  }

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
    cols: Array<{ label: string; width: number; align?: 'right' | 'center' }>,
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
    cols: Array<{ label: string; width: number; align?: 'right' | 'center' }>,
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

  /**
   * Format comptable francophone avec négatifs entre parenthèses
   * (convention DGI / SYSCOHADA). `(1 234,56)` plutôt que `-1 234,56`.
   * `0` reste affiché `0,00`. Vide pour `null` / `undefined` / `''`.
   */
  private fmtPar(value: string | number | undefined | null): string {
    if (value === undefined || value === null || value === '') return '';
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(n)) return '';
    const abs = Math.abs(n);
    const formatted = abs
      .toLocaleString('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      .replace(/[  ]/g, ' ');
    return n < 0 ? `(${formatted})` : formatted;
  }

  private fmtAmt(value: string | number | undefined | null): string {
    if (value === undefined || value === null || value === '') return '';
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(n)) return '';
    // PRODUCT.md : espace fine insécable U+202F comme séparateur de
    // milliers (rendu visuel `1 234 567,89`). `toLocaleString('fr-FR')`
    // renvoie un NARROW NO-BREAK SPACE selon les ICU récents, mais peut
    // tomber sur un simple espace selon l'environnement Node ; on
    // normalise pour garantir la cohérence d'affichage et de tests.
    const formatted = n.toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return formatted.replace(/[  ]/g, ' ');
  }
}
