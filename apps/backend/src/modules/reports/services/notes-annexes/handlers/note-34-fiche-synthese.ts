/**
 * Note 34 — Fiche de synthèse des principaux indicateurs financiers
 * (Guide d'application SYSCOHADA Révisé, Tome 3 p. 69).
 *
 * STRUCTURE OFFICIELLE EXACTE reproduite ici (colonnes N | N-1 | Variation %
 * côté UI ; le handler renvoie la colonne N — le comparatif N-1 sera
 * branché ultérieurement) :
 *
 *   1. ANALYSE DE L'ACTIVITÉ — Soldes Intermédiaires de Gestion
 *        Chiffre d'affaires, Marge commerciale, Valeur ajoutée, EBE,
 *        Résultat d'exploitation, Résultat financier, RAO, RHAO,
 *        Résultat net. (montants, cascade SIG XA→XI)
 *   2. DÉTERMINATION DE LA CAPACITÉ D'AUTOFINANCEMENT (additive)
 *        EBE (= CAFG d'exploitation) + Revenus financiers
 *        + Produits HAO − Frais financiers − Impôts = CAFG
 *        − Dividendes = AUTOFINANCEMENT.
 *   3. ANALYSE DE LA RENTABILITÉ
 *        Rentabilité économique = RAO après impôt théorique (35 %)
 *          / (Capitaux propres + Dettes financières) ;
 *        Rentabilité financière = Résultat net / Capitaux propres.
 *   4. ANALYSE DE LA STRUCTURE FINANCIÈRE
 *        Ressources stables − Actif immobilisé = FONDS DE ROULEMENT (1) ;
 *        ACE − PCE = BESOIN DE FINANCEMENT D'EXPLOITATION (2) ;
 *        ACHAO − PCHAO = BESOIN DE FINANCEMENT HAO (3) ;
 *        BESOIN DE FINANCEMENT GLOBAL (4) = (2)+(3) ;
 *        TRÉSORERIE NETTE (5) = (1)−(4) ;
 *        CONTRÔLE : TN = Trésorerie actif − Trésorerie passif.
 *   5. ANALYSE DE LA VARIATION DE LA TRÉSORERIE
 *        Flux opérationnels − Investissement + Financement
 *          = VARIATION DE LA TRÉSORERIE NETTE DE LA PÉRIODE.
 *   6. ANALYSE DE LA VARIATION DE L'ENDETTEMENT FINANCIER NET
 *        Endettement financier brut = Dettes financières + Trésorerie
 *          passif ; − Trésorerie actif = ENDETTEMENT FINANCIER NET.
 *
 * Chaque ligne porte un code (A1, C1, R1…), un libellé officiel, une
 * formule et la valeur calculée. Les ratios à dénominateur nul renvoient
 * `'N/A'`. La source unique est `deps.synthesisIndicators.getSnapshot`
 * (bilan + SIG + flux agrégés). Si la dépendance n'est pas câblée, on
 * renvoie une ligne « source indisponible ».
 */
import type { NoteHandler, NoteRow, NoteSynthesisSnapshot } from '../types';

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  if (Math.abs(denominator) < 0.005) return null;
  return numerator / denominator;
}

function fmtPercent(v: number | null): string {
  if (v === null) return 'N/A';
  return `${(v * 100).toFixed(2)} %`;
}

function fmtAmount(value: number | string): string {
  const n = typeof value === 'number' ? value : num(value);
  return n.toFixed(2);
}

/**
 * Sections officielles de la Note 34 (remplacent les 5 blocs inventés
 * Activité/Structure/Rentabilité/Liquidité/Endettement).
 */
export type SyntheseBloc =
  | 'ACTIVITE'
  | 'CAFG'
  | 'RENTABILITE'
  | 'STRUCTURE'
  | 'VARIATION_TRESORERIE'
  | 'ENDETTEMENT';

export interface SyntheseLine {
  readonly key: string;
  readonly bloc: SyntheseBloc;
  readonly label: string;
  readonly formula: string;
  readonly value: string;
  readonly unit: 'PERCENT' | 'AMOUNT';
}

/**
 * Guide SYSCOHADA révisé (Note 34, p. 69) : la rentabilité économique se
 * calcule sur le résultat d'exploitation APRÈS impôt théorique sur le
 * bénéfice. « Le taux d'impôt théorique retenu par la société est de 35 % ».
 */
const TAUX_IMPOT_THEORIQUE = 0.35;

function amount(
  key: string,
  bloc: SyntheseBloc,
  label: string,
  formula: string,
  value: number | string,
): SyntheseLine {
  return { key, bloc, label, formula, value: fmtAmount(value), unit: 'AMOUNT' };
}

function percent(
  key: string,
  bloc: SyntheseBloc,
  label: string,
  formula: string,
  v: number | null,
): SyntheseLine {
  return { key, bloc, label, formula, value: fmtPercent(v), unit: 'PERCENT' };
}

export function computeLines(snap: NoteSynthesisSnapshot): ReadonlyArray<SyntheseLine> {
  // Section 3 — rentabilité.
  const rao = num(snap.resultatExploitation); // XE — résultat d'exploitation
  const rn = num(snap.resultatNet);
  const cp = num(snap.totalCapitauxPropres);
  const df = num(snap.dettesFinancieres);
  const raoApresImpot = rao * (1 - TAUX_IMPOT_THEORIQUE);
  const capitauxInvestis = cp + df;

  // Section 6 — endettement financier net.
  const tp = num(snap.tresoreriePassif);
  const ta = num(snap.tresorerieActif);
  const endettementBrut = df + tp;
  const endettementNet = endettementBrut - ta;

  // Section 5 — variation de la trésorerie.
  const fluxOp = num(snap.fluxOperationnels);
  const fluxInv = num(snap.fluxInvestissement);
  const fluxFin = num(snap.fluxFinancement);
  const variationTresorerie = fluxOp + fluxInv + fluxFin;

  return [
    // ── Section 1 — ANALYSE DE L'ACTIVITÉ (SIG) ───────────────────────
    amount('A1', 'ACTIVITE', "Chiffre d'affaires", 'SIG XB', snap.chiffreAffaires),
    amount('A2', 'ACTIVITE', 'Marge commerciale', 'SIG XA', snap.margeCommerciale),
    amount('A3', 'ACTIVITE', 'Valeur ajoutée', 'SIG XC', snap.valeurAjoutee),
    amount(
      'A4',
      'ACTIVITE',
      "Excédent brut d'exploitation (EBE)",
      'SIG XD',
      snap.excedentBrutExploitation,
    ),
    amount('A5', 'ACTIVITE', "Résultat d'exploitation", 'SIG XE', snap.resultatExploitation),
    amount('A6', 'ACTIVITE', 'Résultat financier', 'SIG XF', snap.resultatFinancier),
    amount('A7', 'ACTIVITE', 'Résultat des activités ordinaires', 'SIG XG', snap.resultatAO),
    amount('A8', 'ACTIVITE', 'Résultat hors activités ordinaires', 'SIG XH', snap.resultatHAO),
    amount('A9', 'ACTIVITE', 'Résultat net', 'SIG XI', snap.resultatNet),

    // ── Section 2 — DÉTERMINATION DE LA CAFG (additive) ───────────────
    amount(
      'C1',
      'CAFG',
      "Excédent brut d'exploitation (= CAFG d'exploitation)",
      'EBE (SIG XD)',
      snap.cafgExploitation,
    ),
    amount('C2', 'CAFG', '(+) Revenus financiers', 'SIG TK + TL + TM', snap.revenusFinanciers),
    amount('C3', 'CAFG', '(+) Produits HAO (encaissables)', 'SIG TO', snap.produitsHAO),
    amount('C4', 'CAFG', '(−) Frais financiers', 'SIG RM', snap.fraisFinanciers),
    amount('C5', 'CAFG', '(−) Impôts sur les résultats', 'SIG RS', snap.impotsResultat),
    amount(
      'C6',
      'CAFG',
      "CAPACITÉ D'AUTOFINANCEMENT GLOBALE (CAFG)",
      'EBE + rev. fin. + prod. HAO − frais fin. − impôts',
      snap.cafg,
    ),
    amount('C7', 'CAFG', '(−) Distributions de dividendes opérées', 'Dividendes versés', snap.dividendes),
    amount('C8', 'CAFG', 'AUTOFINANCEMENT', 'CAFG − dividendes', snap.autofinancement),

    // ── Section 3 — ANALYSE DE LA RENTABILITÉ ─────────────────────────
    percent(
      'R1',
      'RENTABILITE',
      'Rentabilité économique',
      "Résultat d'exploitation × (1 − 35 %) / (Capitaux propres + Dettes financières)",
      ratio(raoApresImpot, capitauxInvestis),
    ),
    percent(
      'R2',
      'RENTABILITE',
      'Rentabilité financière',
      'Résultat net / Capitaux propres',
      ratio(rn, cp),
    ),

    // ── Section 4 — ANALYSE DE LA STRUCTURE FINANCIÈRE ────────────────
    amount(
      'S1',
      'STRUCTURE',
      'Capitaux propres + Dettes financières (Ressources stables)',
      'CP + Dettes financières',
      capitauxInvestis,
    ),
    amount('S2', 'STRUCTURE', '(−) Actif immobilisé', 'Bilan AZ', snap.actifImmobilise),
    amount('S3', 'STRUCTURE', 'FONDS DE ROULEMENT (1)', '(CP + DF) − Actif immobilisé', snap.fondsRoulement),
    amount(
      'S4',
      'STRUCTURE',
      "(+) Actif circulant d'exploitation",
      'Bilan BK − BA',
      snap.actifCircExploitation,
    ),
    amount(
      'S5',
      'STRUCTURE',
      "(−) Passif circulant d'exploitation",
      'Bilan DP − DH',
      snap.passifCircExploitation,
    ),
    amount(
      'S6',
      'STRUCTURE',
      "BESOIN DE FINANCEMENT D'EXPLOITATION (2)",
      'ACE − PCE',
      snap.besoinFinExploitation,
    ),
    amount('S7', 'STRUCTURE', '(+) Actif circulant HAO', 'Bilan BA (485/488)', snap.actifCircHAO),
    amount('S8', 'STRUCTURE', '(−) Passif circulant HAO', 'Bilan DH (481/482/484)', snap.passifCircHAO),
    amount('S9', 'STRUCTURE', 'BESOIN DE FINANCEMENT HAO (3)', 'ACHAO − PCHAO', snap.besoinFinHAO),
    amount('S10', 'STRUCTURE', 'BESOIN DE FINANCEMENT GLOBAL (4)', '(2) + (3)', snap.besoinFinGlobal),
    amount('S11', 'STRUCTURE', 'TRÉSORERIE NETTE (5)', '(1) − (4)', snap.tresorerieNette),
    amount(
      'S12',
      'STRUCTURE',
      'CONTRÔLE : Trésorerie actif − Trésorerie passif',
      'Trésorerie actif (BT) − Trésorerie passif (DT)',
      ta - tp,
    ),

    // ── Section 5 — ANALYSE DE LA VARIATION DE LA TRÉSORERIE ──────────
    amount(
      'V1',
      'VARIATION_TRESORERIE',
      'Flux de trésorerie des activités opérationnelles',
      'TFT ZB',
      snap.fluxOperationnels,
    ),
    amount(
      'V2',
      'VARIATION_TRESORERIE',
      "(−) Flux d'investissement",
      'TFT ZC',
      snap.fluxInvestissement,
    ),
    amount('V3', 'VARIATION_TRESORERIE', '(+) Flux de financement', 'TFT ZF', snap.fluxFinancement),
    amount(
      'V4',
      'VARIATION_TRESORERIE',
      'VARIATION DE LA TRÉSORERIE NETTE DE LA PÉRIODE',
      'ZB + ZC + ZF',
      variationTresorerie,
    ),

    // ── Section 6 — VARIATION DE L'ENDETTEMENT FINANCIER NET ──────────
    amount(
      'E1',
      'ENDETTEMENT',
      'Endettement financier brut',
      'Dettes financières + Trésorerie passif',
      endettementBrut,
    ),
    amount('E2', 'ENDETTEMENT', '(−) Trésorerie actif', 'Trésorerie actif', ta),
    amount(
      'E3',
      'ENDETTEMENT',
      'ENDETTEMENT FINANCIER NET',
      'Dettes financières + Trésorerie passif − Trésorerie actif',
      endettementNet,
    ),
  ];
}

export const handleN34FicheSynthese: NoteHandler = async (ctx, deps) => {
  if (!deps.synthesisIndicators) {
    return {
      rows: [
        {
          key: 'SOURCE_UNAVAILABLE',
          label: 'Source de données indisponible — wiring backend requis',
          values: { bloc: 'SYSTEME', formula: '', value: 'N/A', unit: 'AMOUNT' },
        },
      ],
      applicable: true,
    };
  }

  const snapshot = await deps.synthesisIndicators.getSnapshot(
    ctx.organizationId as string,
    ctx.periodStart,
    ctx.periodEnd,
  );

  const lines = computeLines(snapshot);
  const rows: NoteRow[] = lines.map((l) => ({
    key: l.key,
    label: l.label,
    values: {
      bloc: l.bloc,
      formula: l.formula,
      value: l.value,
      unit: l.unit,
    },
  }));

  return { rows, applicable: true };
};
