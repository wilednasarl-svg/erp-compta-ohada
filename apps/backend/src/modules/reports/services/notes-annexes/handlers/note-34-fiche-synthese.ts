/**
 * Note 34 — Fiche de synthèse des principaux indicateurs financiers
 * (Tome 3 p. 69).
 *
 * Doctrine : synthèse normalisée en 5 blocs lus par les analystes /
 * CAC pour caractériser la situation financière de l'entité :
 *
 *   1. ACTIVITE      — CA, valeur ajoutée, EBE/CA, marge brute
 *   2. STRUCTURE     — capitaux propres, total bilan, indépendance fin.
 *   3. RENTABILITE   — RAO/CA, ROE, ROA
 *   4. LIQUIDITE     — ratios général et immédiat
 *   5. ENDETTEMENT   — dettes financières / capitaux propres
 *
 * Chaque ligne porte un code lettré (A1, S1…), un libellé, la formule
 * et la valeur calculée (ratio sans unité, pourcentage ou montant brut
 * — la convention est documentée dans le champ `unit`). Les ratios à
 * dénominateur nul renvoient `'N/A'` plutôt qu'un Infinity (l'UI
 * affiche un tiret).
 *
 * Source unique : `deps.synthesisIndicators.getSnapshot` qui agrège
 * en parallèle bilan + SIG + flux. Si la dépendance n'est pas câblée
 * (ex. tests registry mock), on renvoie une ligne « source
 * indisponible » mais la note reste applicable.
 */
import type {
  NoteHandler,
  NoteRow,
  NoteSynthesisSnapshot,
} from '../types';

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  if (Math.abs(denominator) < 0.005) return null;
  return numerator / denominator;
}

function fmtRatio(v: number | null, unit: 'PERCENT' | 'RATIO' | 'AMOUNT'): string {
  if (v === null) return 'N/A';
  if (unit === 'PERCENT') return `${(v * 100).toFixed(2)} %`;
  if (unit === 'RATIO') return v.toFixed(2);
  return v.toFixed(2);
}

function fmtAmount(s: string): string {
  return num(s).toFixed(2);
}

interface SyntheseLine {
  readonly key: string;
  readonly bloc: 'ACTIVITE' | 'STRUCTURE' | 'RENTABILITE' | 'LIQUIDITE' | 'ENDETTEMENT';
  readonly label: string;
  readonly formula: string;
  readonly value: string;
  readonly unit: 'PERCENT' | 'RATIO' | 'AMOUNT';
}

function computeLines(snap: NoteSynthesisSnapshot): ReadonlyArray<SyntheseLine> {
  const ca = num(snap.chiffreAffaires);
  const va = num(snap.valeurAjoutee);
  const ebe = num(snap.excedentBrutExploitation);
  const rao = num(snap.resultatExploitation);
  const rn = num(snap.resultatNet);
  const totalActif = num(snap.totalActif);
  const cp = num(snap.totalCapitauxPropres);
  const df = num(snap.dettesFinancieres);
  const ac = num(snap.actifCirculant);
  const ta = num(snap.tresorerieActif);
  const pc = num(snap.passifCirculant);
  const tp = num(snap.tresoreriePassif);
  const passifCourtTerme = pc + tp;

  const lines: SyntheseLine[] = [
    // Bloc 1 — ACTIVITE
    {
      key: 'A1',
      bloc: 'ACTIVITE',
      label: "Chiffre d'affaires",
      formula: 'Σ comptes 70',
      value: fmtAmount(snap.chiffreAffaires),
      unit: 'AMOUNT',
    },
    {
      key: 'A2',
      bloc: 'ACTIVITE',
      label: 'Valeur ajoutée',
      formula: 'SIG XC',
      value: fmtAmount(snap.valeurAjoutee),
      unit: 'AMOUNT',
    },
    {
      key: 'A3',
      bloc: 'ACTIVITE',
      label: 'Taux de valeur ajoutée',
      formula: 'VA / CA',
      value: fmtRatio(ratio(va, ca), 'PERCENT'),
      unit: 'PERCENT',
    },
    {
      key: 'A4',
      bloc: 'ACTIVITE',
      label: 'Taux de marge brute (EBE / CA)',
      formula: 'EBE / CA',
      value: fmtRatio(ratio(ebe, ca), 'PERCENT'),
      unit: 'PERCENT',
    },

    // Bloc 2 — STRUCTURE
    {
      key: 'S1',
      bloc: 'STRUCTURE',
      label: 'Capitaux propres',
      formula: 'Bilan passif — capitaux propres',
      value: fmtAmount(snap.totalCapitauxPropres),
      unit: 'AMOUNT',
    },
    {
      key: 'S2',
      bloc: 'STRUCTURE',
      label: 'Total bilan',
      formula: 'Σ actif',
      value: fmtAmount(snap.totalActif),
      unit: 'AMOUNT',
    },
    {
      key: 'S3',
      bloc: 'STRUCTURE',
      label: 'Indépendance financière',
      formula: 'Capitaux propres / Total bilan',
      value: fmtRatio(ratio(cp, totalActif), 'PERCENT'),
      unit: 'PERCENT',
    },

    // Bloc 3 — RENTABILITE
    {
      key: 'R1',
      bloc: 'RENTABILITE',
      label: 'Rentabilité économique (RAO / CA)',
      formula: "Résultat d'exploitation / CA",
      value: fmtRatio(ratio(rao, ca), 'PERCENT'),
      unit: 'PERCENT',
    },
    {
      key: 'R2',
      bloc: 'RENTABILITE',
      label: 'Rentabilité financière (ROE)',
      formula: 'Résultat net / Capitaux propres',
      value: fmtRatio(ratio(rn, cp), 'PERCENT'),
      unit: 'PERCENT',
    },
    {
      key: 'R3',
      bloc: 'RENTABILITE',
      label: "Rentabilité économique de l'actif (ROA)",
      formula: 'EBE / Total actif',
      value: fmtRatio(ratio(ebe, totalActif), 'PERCENT'),
      unit: 'PERCENT',
    },

    // Bloc 4 — LIQUIDITE
    {
      key: 'L1',
      bloc: 'LIQUIDITE',
      label: 'Liquidité générale',
      formula: '(Actif circulant + Trésorerie actif) / Passif court terme',
      value: fmtRatio(ratio(ac + ta, passifCourtTerme), 'RATIO'),
      unit: 'RATIO',
    },
    {
      key: 'L2',
      bloc: 'LIQUIDITE',
      label: 'Liquidité immédiate',
      formula: 'Trésorerie actif / Passif court terme',
      value: fmtRatio(ratio(ta, passifCourtTerme), 'RATIO'),
      unit: 'RATIO',
    },

    // Bloc 5 — ENDETTEMENT
    {
      key: 'E1',
      bloc: 'ENDETTEMENT',
      label: 'Endettement net',
      formula: 'Dettes financières / Capitaux propres',
      value: fmtRatio(ratio(df, cp), 'RATIO'),
      unit: 'RATIO',
    },
    {
      key: 'E2',
      bloc: 'ENDETTEMENT',
      label: 'Variation nette de trésorerie',
      formula: 'TFT — variation période',
      value: fmtAmount(snap.variationTresorerie),
      unit: 'AMOUNT',
    },
  ];

  return lines;
}

export const handleN34FicheSynthese: NoteHandler = async (ctx, deps) => {
  if (!deps.synthesisIndicators) {
    return {
      rows: [
        {
          key: 'SOURCE_UNAVAILABLE',
          label: 'Source de données indisponible — wiring backend requis',
          values: { bloc: 'SYSTEME', formula: '', value: 'N/A', unit: 'RATIO' },
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
