/**
 * États dérivables d'une balance de SOLDES (sans accès base, fonctions
 * PURES). Utilisé par `ReportsService.getReportsFromBalance` pour
 * compléter le Bilan + Compte de résultat déjà calculés avec :
 *
 *   - `buildTrialBalanceFromRows`  → Balance générale (TrialBalanceReport)
 *   - `buildSigFromRows`           → Soldes Intermédiaires de Gestion (SigReport)
 *   - `buildRatiosFromReports`     → Ratios financiers (FinancialRatiosReport, Note 34)
 *   - `buildPartialAnnexeFromRows` → Annexe PARTIELLE (AnnexeReport | null)
 *
 * CONVENTIONS — strictement alignées sur l'existant :
 *   - Les `trialRows` issus de `getReportsFromBalance` portent
 *     `periodDebit = debit`, `periodCredit = credit`,
 *     `endingDebit = debit`, `endingCredit = credit` (balance de soldes :
 *     pas d'à-nouveaux distincts). La logique SIG ci-dessous reproduit
 *     fidèlement `ReportsService.computeSigBare` qui travaille sur
 *     `periodDebit`/`periodCredit`.
 *   - Le calcul des ratios reproduit `ReportsService.getFinancialRatios`
 *     (mêmes numérateurs/dénominateurs, mêmes seuils OHADA / Note 34).
 *
 * Aucune donnée n'est fabriquée : les notes d'annexe non calculables
 * depuis des soldes sont marquées MANUAL/PARTIAL, jamais inventées.
 */
import type { TrialBalanceRow } from '../repositories/reports.repository';
import type {
  AnnexeNote,
  AnnexeReport,
  BalanceSheetReport,
  FinancialRatio,
  FinancialRatiosReport,
  RatioCategory,
  SigReport,
  SoldeIntermediaire,
  SyscohadaPosteAmount,
  TrialBalanceReport,
} from './reports.service';
import {
  CHARGE_POSTES,
  PRODUIT_POSTES,
  SOLDES_INTERMEDIAIRES,
  matchPoste,
} from './syscohada-postes';

const EPSILON = 0.005;

// ─────────────────────────────────────────────────────────────────────
// 1. Balance générale
// ─────────────────────────────────────────────────────────────────────

/**
 * Projette les lignes de balance déjà construites en `TrialBalanceReport`.
 * Réutilise la même agrégation de totaux que
 * `ReportsService.computeTrialBalanceTotals` (somme colonne par colonne).
 */
export function buildTrialBalanceFromRows(
  trialRows: readonly TrialBalanceRow[],
  fromDate: string,
  toDate: string,
): TrialBalanceReport {
  const sum = (key: keyof TrialBalanceRow): number =>
    trialRows.reduce((s, r) => s + Number(r[key] as string), 0);
  return {
    fromDate,
    toDate,
    rows: trialRows,
    totals: {
      openingDebit: sum('openingDebit').toFixed(2),
      openingCredit: sum('openingCredit').toFixed(2),
      periodDebit: sum('periodDebit').toFixed(2),
      periodCredit: sum('periodCredit').toFixed(2),
      endingDebit: sum('endingDebit').toFixed(2),
      endingCredit: sum('endingCredit').toFixed(2),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// 2. Soldes Intermédiaires de Gestion (SIG)
// ─────────────────────────────────────────────────────────────────────

/**
 * Calcule les SIG (cascade SYSCOHADA Vol. 3 du Guide d'application) à
 * partir de lignes de balance. Réplique exactement la logique de
 * `ReportsService.computeSigBare` — qui agrège sur `periodDebit` /
 * `periodCredit` — sans accès base.
 *
 * Postes de VARIATION de stock (RB/RD/RF) et PRODUCTION stockée (TG) :
 * leur net est conservé signé (cohérence marge / valeur ajoutée). Les
 * autres postes sont écrêtés à 0 (un net négatif y traduit une
 * contre-passation parasite).
 */
export function buildSigFromRows(
  trialRows: readonly TrialBalanceRow[],
  fromDate: string,
  toDate: string,
): SigReport {
  const posteAmounts = new Map<string, number>();
  const SIGNED_VARIATION_POSTES = new Set(['RB', 'RD', 'RF', 'TG']);

  for (const row of trialRows) {
    const poste = matchPoste(row.accountCode);
    if (poste === null) continue;
    const periodD = Number(row.periodDebit);
    const periodC = Number(row.periodCredit);
    const net = poste.side === 'CHARGE' ? periodD - periodC : periodC - periodD;
    const display = SIGNED_VARIATION_POSTES.has(poste.code) ? net : Math.max(net, 0);
    posteAmounts.set(poste.code, (posteAmounts.get(poste.code) ?? 0) + display);
  }

  const get = (code: string): number => posteAmounts.get(code) ?? 0;

  const XA = get('TA') - get('RA') - get('RB');
  const XB = get('TA') + get('TB') + get('TC') + get('TD');
  const sumOtherProduits = get('TE') + get('TF') + get('TG') + get('TH') + get('TI');
  const sumConsommations =
    get('RC') + get('RD') + get('RE') + get('RF') + get('RG') + get('RH') + get('RI') + get('RJ');
  const XC = XB - get('RA') - get('RB') + sumOtherProduits - sumConsommations;
  const XD = XC - get('RK');
  const XE = XD + get('TJ') - get('RL');
  const XF = get('TK') + get('TL') + get('TM') - get('RM');
  const XG = XE + XF;
  const XH = get('TN') + get('TO') - get('RO') - get('RP');
  const XI = XG + XH - get('RQ') - get('RS');

  const soldeValues: Record<string, number> = { XA, XB, XC, XD, XE, XF, XG, XH, XI };

  const charges: SyscohadaPosteAmount[] = CHARGE_POSTES.map((p) => ({
    code: p.code,
    label: p.label,
    side: 'CHARGE' as const,
    amount: (posteAmounts.get(p.code) ?? 0).toFixed(2),
  }));
  const produits: SyscohadaPosteAmount[] = PRODUIT_POSTES.map((p) => ({
    code: p.code,
    label: p.label,
    side: 'PRODUIT' as const,
    amount: (posteAmounts.get(p.code) ?? 0).toFixed(2),
  }));
  const soldes: SoldeIntermediaire[] = SOLDES_INTERMEDIAIRES.map((s) => ({
    code: s.code,
    label: s.label,
    formula: s.formula,
    amount: soldeValues[s.code].toFixed(2),
  }));

  return { fromDate, toDate, charges, produits, soldes };
}

// ─────────────────────────────────────────────────────────────────────
// 3. Ratios financiers (conformes Note 34 — Tome 3 p. 69)
// ─────────────────────────────────────────────────────────────────────

function makeRatio(args: {
  code: string;
  label: string;
  category: RatioCategory;
  formula: string;
  numerator: number;
  denominator: number;
  unit: 'PERCENT' | 'RATIO' | 'DAYS';
  interpret?: (v: number | null) => string | undefined;
}): FinancialRatio {
  const denomZero = Math.abs(args.denominator) < EPSILON;
  const raw = denomZero ? null : args.numerator / args.denominator;
  const displayValue =
    raw === null
      ? null
      : args.unit === 'PERCENT'
        ? raw * 100
        : args.unit === 'DAYS'
          ? Math.round(raw)
          : raw;
  const value =
    displayValue === null
      ? null
      : args.unit === 'PERCENT'
        ? displayValue.toFixed(2)
        : args.unit === 'DAYS'
          ? displayValue.toString()
          : displayValue.toFixed(4);
  return {
    code: args.code,
    label: args.label,
    category: args.category,
    formula: args.formula,
    numerator: args.numerator.toFixed(2),
    denominator: args.denominator.toFixed(2),
    value,
    unit: args.unit,
    interpretation: args.interpret?.(displayValue),
  };
}

/**
 * Partie PURE de `ReportsService.getFinancialRatios` : compose le bilan
 * et le SIG déjà calculés en 5 familles de ratios (STRUCTURE, LIQUIDITE,
 * SOLVABILITE, RENTABILITE, ACTIVITE). Mêmes formules, seuils et
 * conventions que l'existant — alignées Note 34 (fiche de synthèse).
 */
export function buildRatiosFromReports(
  bilan: BalanceSheetReport,
  sig: SigReport,
  asAtDate: string,
  fiscalYearStartDate: string,
): FinancialRatiosReport {
  const sectionTotal = (sections: BalanceSheetReport['actif']['sections'], key: string): number =>
    Number(sections.find((s) => s.key === key)?.total ?? '0');

  const totalActif = Number(bilan.actif.total);
  const totalPassif = Number(bilan.passif.total);
  const actifImmobilise = sectionTotal(bilan.actif.sections, 'IMMOBILISE');
  const actifCirculant = sectionTotal(bilan.actif.sections, 'CIRCULANT');
  const tresoActif = sectionTotal(bilan.actif.sections, 'TRESORERIE_ACTIF');
  const capitauxPropres = sectionTotal(bilan.passif.sections, 'CAPITAUX_PROPRES');
  const dettesFinancieres = sectionTotal(bilan.passif.sections, 'DETTES_FINANCIERES');
  const passifCirculant = sectionTotal(bilan.passif.sections, 'PASSIF_CIRCULANT');
  const tresoPassif = sectionTotal(bilan.passif.sections, 'TRESORERIE_PASSIF');

  const soldeByCode = (code: string): number =>
    Number(sig.soldes.find((s) => s.code === code)?.amount ?? '0');
  const chiffreAffaires = soldeByCode('XB');
  const valeurAjoutee = soldeByCode('XC');
  const ebe = soldeByCode('XD');
  const resultatExploit = soldeByCode('XE');
  const resultatNet = soldeByCode('XI');

  const passifCourtTerme = passifCirculant + tresoPassif;
  const ressourcesStables = capitauxPropres + dettesFinancieres;
  const fondsRoulement = ressourcesStables - actifImmobilise;
  const bfr = actifCirculant - passifCirculant;

  const ratios: FinancialRatio[] = [
    makeRatio({
      code: 'AF',
      label: 'Autonomie financière',
      category: 'STRUCTURE',
      formula: 'Capitaux propres / Total bilan',
      numerator: capitauxPropres,
      denominator: totalPassif,
      unit: 'PERCENT',
      interpret: (v) =>
        v === null ? undefined : v >= 30 ? 'bon (≥ 30 %)' : v >= 20 ? 'à surveiller' : 'faible',
    }),
    makeRatio({
      code: 'EF',
      label: 'Endettement financier',
      category: 'STRUCTURE',
      formula: 'Dettes financières / Capitaux propres',
      numerator: dettesFinancieres,
      denominator: capitauxPropres,
      unit: 'RATIO',
      interpret: (v) =>
        v === null ? undefined : v <= 1 ? 'bon (≤ 1)' : v <= 2 ? 'à surveiller' : 'élevé',
    }),
    makeRatio({
      code: 'FR',
      label: 'Couverture des emplois stables',
      category: 'STRUCTURE',
      formula: 'Ressources stables / Actif immobilisé',
      numerator: ressourcesStables,
      denominator: actifImmobilise,
      unit: 'RATIO',
      interpret: (v) =>
        v === null
          ? undefined
          : v >= 1
            ? 'fonds de roulement positif'
            : 'fonds de roulement négatif',
    }),
    makeRatio({
      code: 'LG',
      label: 'Liquidité générale',
      category: 'LIQUIDITE',
      formula: '(Actif circulant + Trésorerie actif) / Passif court terme',
      numerator: actifCirculant + tresoActif,
      denominator: passifCourtTerme,
      unit: 'RATIO',
      interpret: (v) =>
        v === null ? undefined : v >= 1.5 ? 'bon' : v >= 1 ? 'acceptable' : 'tendu',
    }),
    makeRatio({
      code: 'LI',
      label: 'Liquidité immédiate',
      category: 'LIQUIDITE',
      formula: 'Trésorerie actif / Passif court terme',
      numerator: tresoActif,
      denominator: passifCourtTerme,
      unit: 'RATIO',
      interpret: (v) =>
        v === null ? undefined : v >= 0.2 ? 'bon' : v >= 0.1 ? 'à surveiller' : 'faible',
    }),
    makeRatio({
      code: 'SG',
      label: 'Solvabilité générale',
      category: 'SOLVABILITE',
      formula: 'Total actif / Total dettes',
      numerator: totalActif,
      denominator: dettesFinancieres + passifCourtTerme,
      unit: 'RATIO',
      interpret: (v) =>
        v === null ? undefined : v >= 1.5 ? 'bon' : v >= 1 ? 'limite' : 'critique',
    }),
    makeRatio({
      code: 'RE',
      label: "Rentabilité d'exploitation",
      category: 'RENTABILITE',
      formula: "Résultat d'exploitation / Chiffre d'affaires",
      numerator: resultatExploit,
      denominator: chiffreAffaires,
      unit: 'PERCENT',
    }),
    makeRatio({
      code: 'RC',
      label: 'Rentabilité commerciale (marge nette)',
      category: 'RENTABILITE',
      formula: "Résultat net / Chiffre d'affaires",
      numerator: resultatNet,
      denominator: chiffreAffaires,
      unit: 'PERCENT',
    }),
    makeRatio({
      code: 'RF',
      label: 'Rentabilité financière (ROE)',
      category: 'RENTABILITE',
      formula: 'Résultat net / Capitaux propres',
      numerator: resultatNet,
      denominator: capitauxPropres,
      unit: 'PERCENT',
      interpret: (v) =>
        v === null ? undefined : v >= 10 ? 'bon (≥ 10 %)' : v >= 5 ? 'modéré' : 'faible',
    }),
    makeRatio({
      code: 'RA',
      label: "Rentabilité économique de l'actif",
      category: 'RENTABILITE',
      formula: 'EBE / Total actif',
      numerator: ebe,
      denominator: totalActif,
      unit: 'PERCENT',
    }),
    makeRatio({
      code: 'VA',
      label: 'Productivité — VA / CA',
      category: 'ACTIVITE',
      formula: "Valeur ajoutée / Chiffre d'affaires",
      numerator: valeurAjoutee,
      denominator: chiffreAffaires,
      unit: 'PERCENT',
    }),
    makeRatio({
      code: 'BFR',
      label: 'Poids du BFR',
      category: 'ACTIVITE',
      formula: "Besoin en fonds de roulement / Chiffre d'affaires (en jours)",
      numerator: bfr * 360,
      denominator: chiffreAffaires,
      unit: 'DAYS',
    }),
    makeRatio({
      code: 'FRNG',
      label: 'Fonds de roulement net global',
      category: 'STRUCTURE',
      formula: 'Ressources stables − Actif immobilisé',
      numerator: fondsRoulement,
      denominator: 1, // valeur absolue, pas un quotient
      unit: 'RATIO',
      interpret: () => (fondsRoulement >= 0 ? 'positif' : 'négatif (déséquilibre structurel)'),
    }),
  ];

  return { asAtDate, fiscalYearStartDate, ratios };
}

// ─────────────────────────────────────────────────────────────────────
// 4. Annexe PARTIELLE
// ─────────────────────────────────────────────────────────────────────

/**
 * Préfixes calculables note par note depuis une balance de SOLDES.
 * Chaque entrée produit le total agrégé (valeur absolue du net) des
 * comptes dont le code commence par l'un des préfixes, en respectant le
 * sens naturel attendu (Débit pour l'actif, Crédit pour le passif).
 */
interface ComputableNoteSpec {
  readonly code: string;
  readonly title: string;
  readonly prefixes: readonly string[];
  readonly excludePrefixes?: readonly string[];
  readonly naturalSide: 'D' | 'C';
}

const COMPUTABLE_NOTES: readonly ComputableNoteSpec[] = [
  // Actifs (sens débiteur)
  {
    code: 'Note 3A',
    title: 'Immobilisations brutes',
    prefixes: ['20', '21', '22', '23', '24', '25', '26', '27'],
    excludePrefixes: ['28', '29'],
    naturalSide: 'D',
  },
  {
    code: 'Note 4',
    title: 'Stocks et en-cours (valeur brute)',
    prefixes: ['31', '32', '33', '34', '35', '36', '37', '38'],
    excludePrefixes: ['39'],
    naturalSide: 'D',
  },
  { code: 'Note 7', title: "Charges constatées d'avance", prefixes: ['476'], naturalSide: 'D' },
  { code: 'Note 8', title: 'Trésorerie actif', prefixes: ['52', '53', '54', '57'], naturalSide: 'D' },
  // Capitaux propres / passifs (sens créditeur)
  { code: 'Note 10', title: 'Capital social', prefixes: ['10'], naturalSide: 'C' },
  {
    code: 'Note 11',
    title: 'Primes, réserves, report à nouveau',
    prefixes: ['11', '12'],
    naturalSide: 'C',
  },
  { code: 'Note 12', title: "Subventions d'investissement", prefixes: ['14'], naturalSide: 'C' },
  {
    code: 'Note 13',
    title: 'Provisions pour risques et charges',
    prefixes: ['19'],
    naturalSide: 'C',
  },
  {
    code: 'Note 14',
    title: 'Emprunts et dettes financières',
    prefixes: ['16'],
    naturalSide: 'C',
  },
  {
    code: 'Note 16',
    title: 'Dettes sociales et fiscales',
    prefixes: ['42', '43', '44'],
    naturalSide: 'C',
  },
  { code: 'Note 18', title: 'Trésorerie passif', prefixes: ['56'], naturalSide: 'C' },
];

/** Notes purement narratives ou exigeant un détail absent d'une balance. */
const MANUAL_OR_DETAIL_NOTES: ReadonlyArray<{ code: string; title: string }> = [
  { code: 'Note 1', title: 'Règles et méthodes comptables' },
  { code: 'Note 3B', title: 'Amortissements et provisions sur immobilisations' },
  { code: 'Note 5', title: 'Créances et emplois assimilés (détail/âge)' },
  { code: 'Note 9', title: 'Écarts de conversion' },
  { code: 'Note 15', title: 'Fournisseurs et dettes assimilées (détail/âge)' },
  { code: 'Note 19', title: 'Engagements donnés et reçus (hors bilan)' },
  { code: 'Note 24', title: 'Rémunérations et avantages des dirigeants' },
  { code: 'Note 25', title: 'Transactions avec parties liées' },
  { code: 'Note 26', title: 'Événements postérieurs à la clôture' },
  { code: 'Note 27', title: 'Honoraires des commissaires aux comptes' },
  { code: 'Note 29', title: 'Activités abandonnées ou cédées' },
  { code: 'Note 30', title: 'Information sectorielle' },
];

function noteTotal(trialRows: readonly TrialBalanceRow[], spec: ComputableNoteSpec): number {
  let total = 0;
  for (const row of trialRows) {
    const code = row.accountCode;
    if (!spec.prefixes.some((p) => code.startsWith(p))) continue;
    if (spec.excludePrefixes?.some((p) => code.startsWith(p))) continue;
    const net = Number(row.periodDebit) - Number(row.periodCredit);
    const directional = spec.naturalSide === 'D' ? net : -net;
    if (directional <= EPSILON) continue;
    total += directional;
  }
  return total;
}

/**
 * Construit une Annexe PARTIELLE depuis une balance de soldes.
 *
 * ⚠️ NUMÉROTATION LEGACY — NON CONFORME doctrine (suivi à ouvrir).
 * Les codes « Note 4/7/8/10/11/12/14… » utilisés ci-dessous suivent la
 * numérotation libre historique (cf. `getAnnexe` dans reports.service.ts),
 * et NON le référentiel canonique `notes-annexes/note-registry.ts`
 * (NoteId N1…N36) qui alimente la liasse DSF officielle. Exemples d'écarts :
 * Note 4 (stocks) → doctrine N6 ; Note 10 (capital) → N13 ;
 * Note 14 (emprunts) → N16A ; Note 7 (CCA) → N12. La refonte (aligner les
 * codes sur `NOTE_REGISTRY`) est volontairement reportée : elle change le
 * type public `AnnexeNote` et casse les tests d'assertion legacy
 * (`reports.service.spec`). Cet aperçu reste un raccourci « from-balance ».
 *
 * INCLUS (status COMPUTED) — postes dont le solde agrégé est directement
 * lisible dans la balance : Notes 3A, 4, 7, 8, 10, 11, 12, 13, 14, 16, 18.
 * Chaque note porte un `summary` avec le montant agrégé, sans inventer de
 * ventilation par sous-compte.
 *
 * EXCLUS / MANUAL — notes exigeant du détail absent d'une balance de
 * soldes (mouvements bruts vs amortissements, âge des créances/dettes,
 * informations narratives) : Notes 1, 3B, 5, 9, 15, 19, 24-27, 29, 30.
 * Marquées MANUAL — jamais fabriquées.
 *
 * Retourne `null` si AUCUNE note calculable n'a de montant significatif
 * (balance vide de comptes patrimoniaux), pour éviter une annexe vide
 * trompeuse.
 */
export function buildPartialAnnexeFromRows(
  trialRows: readonly TrialBalanceRow[],
  asAtDate: string,
  fiscalYearStartDate: string,
): AnnexeReport | null {
  const computed: AnnexeNote[] = [];
  for (const spec of COMPUTABLE_NOTES) {
    const total = noteTotal(trialRows, spec);
    if (total <= EPSILON) continue;
    computed.push({
      code: spec.code,
      title: spec.title,
      status: 'COMPUTED',
      source: 'from-balance (soldes)',
      summary: `Montant agrégé depuis la balance : ${total.toFixed(2)}`,
    });
  }

  if (computed.length === 0) return null;

  const manual: AnnexeNote[] = MANUAL_OR_DETAIL_NOTES.map((n) => ({
    code: n.code,
    title: n.title,
    status: 'MANUAL' as const,
    summary: "Non calculable depuis une balance de soldes (détail/narratif requis).",
  }));

  return {
    asAtDate,
    fiscalYearStartDate,
    notes: [...computed, ...manual],
  };
}
