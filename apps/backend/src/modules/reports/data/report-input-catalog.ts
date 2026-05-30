import type { DocumentType } from '../../imports/types/import-status';
import { SOLDES_INTERMEDIAIRES } from '../services/syscohada-postes';

/**
 * Catalogue « rapport financier → fichier à importer + formules ».
 *
 * Pour chaque état SYSCOHADA produit par le module, ce catalogue documente :
 *   1. Le ou les TYPES DE FICHIER à importer (`DocumentType` du pipeline
 *      d'import) qui l'alimentent en amont.
 *   2. La DONNÉE SOURCE réellement lue par le moteur (écritures committées,
 *      balance fournie, ou staging d'import).
 *   3. Les FORMULES DE CALCUL telles qu'implémentées dans le code
 *      (`reports.service.ts`, `cash-flow.service.ts`, dashboards), avec leurs
 *      postes / classes SYSCOHADA.
 *   4. La BASE LÉGALE (Tome / Volume du Guide d'application SYSCOHADA révisé).
 *
 * ─── Chaîne d'ingestion (vue d'ensemble) ─────────────────────────────────
 *
 * La quasi-totalité des états dérivent des ÉCRITURES COMMITTÉES
 * (`journal_entry_lines`). Pour les produire il faut donc d'abord importer un
 * fichier d'écritures (`entries`) — ou un équivalent qui pose des écritures
 * (`general_ledger`, `auxiliary_ledger`, `sales_purchases`, `bank_statement`)
 * — puis le valider et le committer.
 *
 * Deux exceptions n'exigent PAS de poser des écritures :
 *   - `from-balance` : génère Bilan + Compte de résultat directement depuis
 *     une BALANCE uploadée (`trial_balance`), sans validation d'écritures.
 *   - `import-diagnostic` : lit le STAGING d'une session d'import (pré-commit).
 *
 * Les ÉTATS CONSOLIDÉS agrègent les écritures committées de PLUSIEURS
 * organisations (une liasse par entité, consolidées par sommation).
 *
 * Ce module est de la DOCTRINE (donnée de référence statique) : il ne lit
 * aucun état tenant et n'effectue aucun calcul. Les formules y sont des
 * métadonnées textuelles, alignées sur le moteur et gardées par les tests
 * (`report-input-catalog.spec.ts`).
 */

/** Familles de regroupement pour l'affichage du catalogue. */
export type ReportCategory =
  | 'etats-financiers' // les 4 états DSF : Bilan, Compte de résultat, TFT, Annexe
  | 'soldes-balances' // balances et grand livre (soldes par compte)
  | 'analyse' // SIG, ratios, marge analytique, tendances, balance âgée
  | 'consolidation' // états multi-organisations
  | 'liasses' // packages assemblés (DSF, dossier annuel)
  | 'controle'; // diagnostics et validations pré-dépôt

/** Une formule de calcul telle qu'implémentée dans le moteur. */
export interface ReportFormula {
  /** Grandeur produite, ex. « Résultat net (XI) ». */
  readonly output: string;
  /** Expression littérale, ex. « XG + XH − RQ − RS ». */
  readonly expression: string;
  /** Base de calcul : postes / classes / source dans le code. */
  readonly basis: string;
}

/** Un type de fichier d'import qui alimente le rapport, et pourquoi. */
export interface ReportImportRequirement {
  readonly documentType: DocumentType;
  /** Raison fonctionnelle du rattachement (ce que ce fichier apporte). */
  readonly rationale: string;
  /**
   * `true` si ce type suffit seul à produire le rapport ; `false` s'il
   * complète une ingestion d'écritures (ex. relevé bancaire pour fiabiliser
   * la trésorerie, grand livre auxiliaire pour la balance âgée).
   */
  readonly sufficientAlone: boolean;
}

/** Spécification complète d'un rapport : entrée requise + formules. */
export interface ReportInputSpec {
  /** Clé stable, alignée sur la route REST (ex. `balance-sheet`, `sig`). */
  readonly reportKey: string;
  /** Libellé métier français. */
  readonly label: string;
  readonly category: ReportCategory;
  /** Route relative sous `/organizations/:id/reports` (ou autre base). */
  readonly endpoint: string;
  /** Type(s) de fichier à importer en amont pour alimenter le rapport. */
  readonly requiredImports: readonly ReportImportRequirement[];
  /** Donnée réellement consommée par le moteur de calcul. */
  readonly sourceData: string;
  /** Formules de calcul vérifiées sur le code. */
  readonly formulas: readonly ReportFormula[];
  /** Base légale SYSCOHADA (Tome / Volume). */
  readonly legalRef: string;
}

// ─── Briques d'import réutilisables ──────────────────────────────────────

/** Écritures comptables — l'ingestion canonique qui pose les `journal_entry_lines`. */
const IMPORT_ENTRIES: ReportImportRequirement = {
  documentType: 'entries',
  rationale:
    "Journal d'écritures (compte + journal + date + libellé + débit/crédit, regroupées par n° de pièce). Source canonique committée dont dérivent tous les états dérivés du grand livre.",
  sufficientAlone: true,
};

/** Balance des comptes — cumul à un instant T, sans poser d'écritures. */
const IMPORT_TRIAL_BALANCE: ReportImportRequirement = {
  documentType: 'trial_balance',
  rationale:
    "Balance générale (compte + libellé + débit/crédit cumulés). Permet de produire Bilan et Compte de résultat sans écritures via l'endpoint `from-balance`.",
  sufficientAlone: true,
};

/** Grand livre — écritures détaillées par compte, alternative à `entries`. */
const IMPORT_GENERAL_LEDGER: ReportImportRequirement = {
  documentType: 'general_ledger',
  rationale:
    'Grand livre (compte + date + libellé + débit/crédit). Pose des écritures par compte ; alternative à un journal `entries` complet.',
  sufficientAlone: true,
};

/** Grand livre auxiliaire — détail par tiers, requis pour l'analyse clients/fournisseurs. */
const IMPORT_AUXILIARY_LEDGER: ReportImportRequirement = {
  documentType: 'auxiliary_ledger',
  rationale:
    'Grand livre auxiliaire (tiers + compte + date + montants). Apporte le détail par tiers indispensable à la balance âgée clients/fournisseurs.',
  sufficientAlone: false,
};

/** Journal de ventes/achats — écritures focalisées chiffre d'affaires/achats. */
const IMPORT_SALES_PURCHASES: ReportImportRequirement = {
  documentType: 'sales_purchases',
  rationale:
    "Journal de ventes/achats (compte + date + libellé + pièce). Alimente le chiffre d'affaires (classe 7) et les achats (classe 6).",
  sufficientAlone: false,
};

/** Relevé bancaire — fiabilise les comptes de trésorerie (classe 5). */
const IMPORT_BANK_STATEMENT: ReportImportRequirement = {
  documentType: 'bank_statement',
  rationale:
    'Relevé bancaire (date + libellé + débit/crédit). Fiabilise les mouvements de trésorerie (classe 5) après rapprochement.',
  sufficientAlone: false,
};

/** Formule SIG depuis la table de référence du code (anti-drift). */
function sigFormula(code: string): ReportFormula {
  const ref = SOLDES_INTERMEDIAIRES.find((s) => s.code === code);
  if (!ref) {
    throw new Error(`SIG inconnu dans SOLDES_INTERMEDIAIRES: ${code}`);
  }
  return {
    output: `${ref.label} (${ref.code})`,
    expression: ref.formula,
    basis: 'Cascade SIG SYSCOHADA — miroir de SOLDES_INTERMEDIAIRES (syscohada-postes.ts).',
  };
}

// ─── Le catalogue ────────────────────────────────────────────────────────

export const REPORT_INPUT_CATALOG: readonly ReportInputSpec[] = [
  // ───── États financiers (les 4 états DSF) ─────────────────────────────
  {
    reportKey: 'balance-sheet',
    label: 'Bilan OHADA (actif / passif)',
    category: 'etats-financiers',
    endpoint: 'GET /reports/balance-sheet',
    requiredImports: [IMPORT_ENTRIES, IMPORT_GENERAL_LEDGER, IMPORT_TRIAL_BALANCE],
    sourceData: 'Soldes cumulés par compte à la date (`accountBalancesAsAt`) — classes 1 à 5.',
    formulas: [
      {
        output: 'Classement Actif / Passif',
        expression:
          'Cl. 2 → Actif immobilisé ; Cl. 3 → Actif circulant ; Cl. 4 → Actif si solde débiteur, Passif si créditeur ; Cl. 5 → Trésorerie actif/passif selon solde ; Cl. 1 (10–15) → Capitaux propres, (16+) → Dettes financières.',
        basis: 'classifyForBilan() — reports.service.ts.',
      },
      {
        output: 'Comptes soustractifs (28x, 29x, 39x, 49x, 59x, 109, 129…)',
        expression: 'montant porté avec contraSign = −1 (vient en déduction du total de section)',
        basis: 'Amortissements / dépréciations / capital non appelé — getBalanceSheet().',
      },
      {
        output: 'Résultat de l’exercice (poste CJ, codes 130/129)',
        expression: 'netResult = totalProduits − totalCharges (incorporé aux capitaux propres)',
        basis: 'computeProfitLossBare() si fiscalYearStartDate fourni.',
      },
      {
        output: 'Contrôle d’équilibre',
        expression: 'totalActif − totalPassif ≈ 0 (résultat incorporé)',
        basis: 'getBalanceSheet() — tolérance d’arrondi < 1 FCFA.',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 / Volume 3 (états financiers AUDCIF).',
  },
  {
    reportKey: 'profit-loss',
    label: 'Compte de résultat (charges / produits)',
    category: 'etats-financiers',
    endpoint: 'GET /reports/profit-loss',
    requiredImports: [IMPORT_ENTRIES, IMPORT_SALES_PURCHASES, IMPORT_TRIAL_BALANCE],
    sourceData: 'Flux de la période (`trialBalance`) filtrés sur les classes 6 et 7.',
    formulas: [
      {
        output: 'Montant d’un poste de charge (classe 6)',
        expression: 'net = −(periodDebit − periodCredit)',
        basis: 'Charges présentées en négatif — getProfitLoss().',
      },
      {
        output: 'Montant d’un poste de produit (classe 7)',
        expression: 'net = +(periodCredit − periodDebit)',
        basis: 'Produits présentés en positif — getProfitLoss().',
      },
      {
        output: 'Résultat net',
        expression: 'résultat = totalProduits − totalCharges',
        basis: 'Σ(classe 7 net) − Σ(classe 6 net).',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 / Volume 3 (compte de résultat).',
  },
  {
    reportKey: 'tft',
    label: 'Tableau de flux de trésorerie (méthode indirecte)',
    category: 'etats-financiers',
    endpoint: 'GET /reports/tft',
    requiredImports: [IMPORT_ENTRIES, IMPORT_BANK_STATEMENT],
    sourceData:
      'Écritures committées des exercices N et N-1 (variations de soldes par classe) + SIG de N.',
    formulas: [
      {
        output: 'ZA — Trésorerie d’ouverture',
        expression: 'solde net classe 5 (50–58) au 1er jour, signé D − C',
        basis: 'netTreasury(signedN1) — cash-flow.service.ts.',
      },
      {
        output: 'FA — Capacité d’autofinancement globale (CAFG)',
        expression: 'XD + 654 − 754 + XF + TO + RP + RQ + RS',
        basis: 'EBE (XD) + résultat financier (XF) + éléments HAO + écarts de change.',
      },
      {
        output: 'ZB — Flux de trésorerie opérationnels',
        expression: 'FA + FB + FC + FD + FE (variations stocks cl.3 et BFR cl.4)',
        basis: 'cash-flow.service.ts — détail FB→FE.',
      },
      {
        output: 'ZC — Flux d’investissement',
        expression: 'FF + FG + FH + FI + FJ (acquisitions/cessions cl.2, créances 485/414)',
        basis: 'Débits/crédits cumulés classe 2 + comptes 82.',
      },
      {
        output: 'ZF — Flux de financement',
        expression: 'ZD (capitaux propres : cl.10/14/465) + ZE (emprunts cl.16–18)',
        basis: 'FK→FN (propres) + FO→FQ (étrangers).',
      },
      {
        output: 'ZG — Variation nette / ZH — Trésorerie de clôture',
        expression: 'ZG = ZB + ZC + ZF ; ZH = ZA + ZG (contrôle vs solde cl.5 à la date)',
        basis: 'cash-flow.service.ts — contrôle de cohérence |ZH − trésorerie réelle| < 1 FCFA.',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 / Volume 3, p. 34 (TFT, méthode indirecte).',
  },
  {
    reportKey: 'annexe',
    label: 'Notes annexes (Notes 1 à 36 AUDCIF)',
    category: 'etats-financiers',
    endpoint: 'GET /reports/annexe',
    requiredImports: [IMPORT_ENTRIES],
    sourceData:
      'Squelette référentiel des 35/36 notes + balances de comptes / SIG pour les notes calculées (3A, 3B, 5, 14, 15, 20, 28…).',
    formulas: [
      {
        output: 'Note 3A — Immobilisations brutes',
        expression: 'soldes débiteurs 21–27 (hors 28/29) ventilés par catégorie',
        basis: 'getAnnexeNoteDetail() — accountBalancesAsAt.',
      },
      {
        output: 'Note 20 — Ventilation du chiffre d’affaires',
        expression: 'TA(701) + TB(702) + TC(704–706) + TD(707) sur [fyStart, asAtDate]',
        basis: 'getAnnexeNoteDetail().',
      },
      {
        output: 'Note 28 — Impôt sur le résultat',
        expression: 'poste RS (89) avec cascade XG → XI',
        basis: 'getAnnexeNoteDetail() via getSig.',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 / Volume 3 (notes annexes 1–36).',
  },

  // ───── Soldes et balances ─────────────────────────────────────────────
  {
    reportKey: 'trial-balance',
    label: 'Balance générale',
    category: 'soldes-balances',
    endpoint: 'GET /reports/trial-balance',
    requiredImports: [IMPORT_ENTRIES, IMPORT_GENERAL_LEDGER],
    sourceData: 'Mouvements par compte sur la période (`trialBalance`) — toutes classes 1–9.',
    formulas: [
      {
        output: 'Solde par compte',
        expression: 'solde = endingDebit − endingCredit (colonne D si > 0, C si < 0)',
        basis: 'getTrialBalance() — présentation en valeur absolue par côté.',
      },
      {
        output: 'Totaux de section',
        expression: 'Σ openingDebit/Credit, Σ periodDebit/Credit, Σ endingDebit/Credit',
        basis: 'getTrialBalance().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 1 (tenue comptable, art. 19 AUDCIF).',
  },
  {
    reportKey: 'comparative-balance',
    label: 'Balance comparative N / N-1',
    category: 'soldes-balances',
    endpoint: 'GET /reports/comparative-balance',
    requiredImports: [IMPORT_ENTRIES, IMPORT_GENERAL_LEDGER],
    sourceData: 'Deux appels `trialBalance` (période N et période N-1).',
    formulas: [
      {
        output: 'Variation par compte',
        expression: 'variation = curNet − prevNet ; variation% = variation / |prevNet| × 100',
        basis: 'getComparativeBalance() — null si prevNet ≈ 0.',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 1 (comparabilité des exercices).',
  },
  {
    reportKey: 'multi-year-balance',
    label: 'Balance pluri-exercices (2 à 5 périodes)',
    category: 'soldes-balances',
    endpoint: 'GET /reports/multi-year-balance',
    requiredImports: [IMPORT_ENTRIES, IMPORT_GENERAL_LEDGER],
    sourceData: 'Un appel `trialBalance` par période demandée.',
    formulas: [
      {
        output: 'Net par période',
        expression: 'netByPeriod[i] = periodDebit_i − periodCredit_i',
        basis: 'getMultiYearBalance().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 1 (tenue comptable).',
  },
  {
    reportKey: 'general-ledger',
    label: 'Grand livre d’un compte',
    category: 'soldes-balances',
    endpoint: 'GET /reports/general-ledger/:accountId',
    requiredImports: [IMPORT_ENTRIES, IMPORT_GENERAL_LEDGER],
    sourceData: 'Lignes d’écritures committées du compte, chronologiques (`generalLedger`).',
    formulas: [
      {
        output: 'Solde courant (running balance)',
        expression: 'cumul = cumul précédent + (débit − crédit) de la ligne',
        basis: 'getGeneralLedger().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 1 (grand livre).',
  },

  // ───── Analyse ────────────────────────────────────────────────────────
  {
    reportKey: 'sig',
    label: 'Soldes intermédiaires de gestion (SIG)',
    category: 'analyse',
    endpoint: 'GET /reports/sig',
    requiredImports: [IMPORT_ENTRIES, IMPORT_SALES_PURCHASES],
    sourceData: 'Flux de la période (`trialBalance`) classes 6 et 7, agrégés par poste lettré.',
    formulas: [
      sigFormula('XA'),
      sigFormula('XB'),
      sigFormula('XC'),
      sigFormula('XD'),
      sigFormula('XE'),
      sigFormula('XF'),
      sigFormula('XG'),
      sigFormula('XH'),
      sigFormula('XI'),
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 / Volume 3 (SIG, cascade XA→XI).',
  },
  {
    reportKey: 'financial-ratios',
    label: 'Ratios financiers',
    category: 'analyse',
    endpoint: 'GET /reports/financial-ratios',
    requiredImports: [IMPORT_ENTRIES, IMPORT_TRIAL_BALANCE],
    sourceData: 'Bilan (à la date) + SIG (sur l’exercice) recombinés.',
    formulas: [
      {
        output: 'Autonomie financière (AF)',
        expression: 'Capitaux propres / Total bilan × 100',
        basis: 'getFinancialRatios() — null si dénominateur ≈ 0.',
      },
      {
        output: 'Liquidité générale (LG)',
        expression: '(Actif circulant + Trésorerie actif) / Passif court terme',
        basis: 'getFinancialRatios().',
      },
      {
        output: 'Solvabilité générale (SG)',
        expression: 'Total actif / (Dettes financières + Passif court terme)',
        basis: 'getFinancialRatios().',
      },
      {
        output: 'Rentabilité nette (RC) / financière (RF/ROE)',
        expression: 'RC = Résultat net / CA × 100 ; RF = Résultat net / Capitaux propres × 100',
        basis: 'getFinancialRatios().',
      },
      {
        output: 'Besoin en fonds de roulement (BFR, jours)',
        expression: '(Actif circulant − Passif circulant) × 360 / Chiffre d’affaires',
        basis: 'getFinancialRatios().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 (analyse financière, ratios indicatifs).',
  },
  {
    reportKey: 'margin-by-axis',
    label: 'Marge par axe analytique (chantier / BU / activité)',
    category: 'analyse',
    endpoint: 'GET /reports/margin-by-axis',
    requiredImports: [
      {
        ...IMPORT_ENTRIES,
        rationale:
          "Journal d'écritures portant les colonnes d'axe analytique (type + code) sur les lignes de charges et produits.",
      },
    ],
    sourceData: 'Mouvements de la période imputés à un axe analytique (`marginByAxis`).',
    formulas: [
      {
        output: 'Marge brute par axe',
        expression: 'Marge = CA (cl.7 net créditeur) − Achats (cl.60 net débiteur)',
        basis: 'getMarginByAxis() — frais généraux non ventilés exclus.',
      },
      {
        output: 'Valeur ajoutée / EBE par axe',
        expression: 'VA = CA − (60+61+62) ; EBE = VA − personnel(66) − impôts/taxes(63)',
        basis: 'getMarginByAxis().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 (comptabilité analytique, aligné Note 34).',
  },
  {
    reportKey: 'aging-balance',
    label: 'Balance âgée clients / fournisseurs',
    category: 'analyse',
    endpoint: 'GET /reports/aging-balance',
    requiredImports: [IMPORT_AUXILIARY_LEDGER, IMPORT_ENTRIES],
    sourceData:
      'Grand livre chronologique (FIFO) + snapshot de solde, comptes 41x (clients) ou 40x (fournisseurs).',
    formulas: [
      {
        output: 'Répartition par ancienneté',
        expression:
          'apurement FIFO des factures par les règlements, puis ventilation du reste en buckets [0–30 | 31–60 | 61–90 | >90 jours] à la date',
        basis: 'getAgingBalance().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 1 (comptes de tiers, classe 4).',
  },
  {
    reportKey: 'cash-trend',
    label: 'Trésorerie nette glissante (mois par mois)',
    category: 'analyse',
    endpoint: 'GET /reports/cash-trend',
    requiredImports: [IMPORT_ENTRIES, IMPORT_BANK_STATEMENT],
    sourceData: 'Snapshot du solde net classe 5 à chaque fin de mois (`accountBalancesAsAt`).',
    formulas: [
      {
        output: 'Trésorerie nette mensuelle',
        expression: 'solde net classe 5 = Σ débit − Σ crédit ; variation = mois − mois précédent',
        basis: 'getCashTrend() — débiteur = disponible, créditeur = découvert.',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 1 (comptes de trésorerie, classe 5).',
  },

  // ───── Consolidation ──────────────────────────────────────────────────
  {
    reportKey: 'consolidated',
    label: 'États consolidés (multi-organisations)',
    category: 'consolidation',
    endpoint: 'GET /dashboards/consolidated',
    requiredImports: [
      {
        ...IMPORT_ENTRIES,
        rationale:
          "Un journal d'écritures committé PAR organisation à consolider. Chaque entité doit avoir son exercice annuel alimenté ; la consolidation somme ensuite les agrégats.",
      },
    ],
    sourceData:
      'Agrégats par organisation (DashboardSummaryService) pour l’exercice annuel, sommés sur les organisations autorisées.',
    formulas: [
      {
        output: 'Trésorerie consolidée',
        expression: 'Σ_org (soldes 51 + 53 + 57, snapshot D − C)',
        basis: 'dashboard-summary.service.ts → dashboard-consolidated.service.ts.',
      },
      {
        output: 'Créances / Dettes consolidées',
        expression: 'Σ_org (41 débit − crédit) ; Σ_org (40 crédit − débit)',
        basis: 'aggregateByCodePrefix.',
      },
      {
        output: 'Produits / Charges / Résultat consolidés (YTD)',
        expression:
          'Σ_org (cl.7 crédit − débit) ; Σ_org (cl.6 débit − crédit) ; netResult = ΣRevenue − ΣExpenses',
        basis: 'getConsolidatedSummary() — devise XOF, contrôle de permission par org.',
      },
    ],
    legalRef:
      'SYSCOHADA révisé — Tome 2 (comptes combinés/consolidés) — agrégation simple par sommation (V1, sans élimination des intra-groupe).',
  },

  // ───── Liasses assemblées ─────────────────────────────────────────────
  {
    reportKey: 'dsf-package',
    label: 'Liasse DSF déposable (R1–R4 + 4 états + notes)',
    category: 'liasses',
    endpoint: 'GET /reports/dsf-package.zip',
    requiredImports: [IMPORT_ENTRIES],
    sourceData:
      'Assemble : fiches R1–R4 (identification) + Bilan + Compte de résultat + TFT (PDF & XLSX) + 36 notes annexes (calculées ou stub).',
    formulas: [
      {
        output: 'Composition',
        expression: 'R1–R4 + Bilan + CR + TFT + Notes 1–36',
        basis: 'reports-package.service.ts — buildDsfPackage().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 / Volume 3 (liasse DSF normalisée).',
  },
  {
    reportKey: 'annual-package',
    label: 'Dossier annuel (balance + états + analyses)',
    category: 'liasses',
    endpoint: 'GET /reports/annual-package.zip',
    requiredImports: [IMPORT_ENTRIES],
    sourceData:
      'Assemble en XLSX : Balance + Balance comparative + CR officiel + Bilan officiel + SIG + Ratios + TFT + Annexe + Balances âgées.',
    formulas: [
      {
        output: 'Composition',
        expression:
          'Balance + Balance N/N-1 + CR + Bilan + SIG + Ratios + TFT + Annexe + Aging clients/fournisseurs',
        basis: 'reports-package.service.ts — buildAnnualPackage().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 (dossier de travail annuel).',
  },

  // ───── Contrôle ───────────────────────────────────────────────────────
  {
    reportKey: 'from-balance',
    label: 'Bilan + CR depuis une balance uploadée',
    category: 'controle',
    endpoint: 'POST /reports/from-balance',
    requiredImports: [IMPORT_TRIAL_BALANCE],
    sourceData:
      'Lignes de balance fournies dans le corps de requête (code + libellé + débit + crédit) — AUCUNE écriture committée requise.',
    formulas: [
      {
        output: 'Bilan + Compte de résultat instantanés',
        expression:
          'classement par classe (1er caractère du code) ; résultat incorporé en 130/129 si fiscalYearStartDate fourni',
        basis: 'getReportsFromBalance() — pré-audit sans validation d’écritures.',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 3 (états financiers depuis balance).',
  },
  {
    reportKey: 'balance-sheet-diagnostic',
    label: 'Diagnostic d’équilibre du bilan',
    category: 'controle',
    endpoint: 'GET /reports/balance-sheet-diagnostic',
    requiredImports: [IMPORT_ENTRIES, IMPORT_TRIAL_BALANCE],
    sourceData: 'Soldes cumulés à la date (`accountBalancesAsAt`) — toutes classes.',
    formulas: [
      {
        output: 'Équilibre du journal',
        expression: 'imbalance = Σ totalDebit − Σ totalCredit ; équilibré si |imbalance| < 1',
        basis: 'getBilanDiagnostic() + checklist travaux de fin d’exercice.',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 1 (partie double, équilibre).',
  },
  {
    reportKey: 'import-diagnostic',
    label: 'Diagnostic d’import (pré-commit)',
    category: 'controle',
    endpoint: 'GET /reports/import-diagnostic/:sessionId',
    requiredImports: [
      {
        ...IMPORT_ENTRIES,
        rationale:
          "Lit le STAGING d'une session d'import (n'importe quel DocumentType) AVANT validation — balance des comptes + anomalies.",
        sufficientAlone: true,
      },
    ],
    sourceData: 'Lignes de staging (`import_staging_entries`), PAS les journaux validés.',
    formulas: [
      {
        output: 'Verdict de conformité',
        expression:
          'balance par compte + anomalies (compte inconnu, date hors exercice, montant illisible…) ; canCommit = aucune anomalie critique',
        basis: 'getImportDiagnostic().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 1 (contrôle de cohérence avant report).',
  },
  {
    reportKey: 'period-validity',
    label: 'Indice de validité de la période',
    category: 'controle',
    endpoint: 'GET /reports/validity',
    requiredImports: [IMPORT_ENTRIES],
    sourceData: 'Agrégat de la période (écritures committées).',
    formulas: [
      {
        output: 'Validité avant génération',
        expression:
          'nb lignes committées + déséquilibre |Σ D − Σ C| (arrondi < 1 → 0) + date du dernier mouvement',
        basis: 'getPeriodValidity().',
      },
    ],
    legalRef: 'SYSCOHADA révisé — Tome 1 (intégrité de la période).',
  },
];

/** Index par clé de rapport, pour un accès O(1). */
export const REPORT_INPUT_CATALOG_BY_KEY: ReadonlyMap<string, ReportInputSpec> = new Map(
  REPORT_INPUT_CATALOG.map((spec) => [spec.reportKey, spec]),
);

/** Spécification d'un rapport par sa clé, ou `null` si inconnue. */
export function getReportInputSpec(reportKey: string): ReportInputSpec | null {
  return REPORT_INPUT_CATALOG_BY_KEY.get(reportKey) ?? null;
}

/** Tous les rapports qu'un type de fichier importé peut alimenter. */
export function getReportsForDocumentType(documentType: DocumentType): readonly ReportInputSpec[] {
  return REPORT_INPUT_CATALOG.filter((spec) =>
    spec.requiredImports.some((req) => req.documentType === documentType),
  );
}
