/**
 * Note 3D — Amortissements de la période.
 *
 * Une ligne par asset amorti dans l'exercice, plus une ligne TOTAL.
 * Source : `depreciation_schedules` filtré sur `fiscal_year = exerciseYear`.
 *
 * Champs :
 *   - dotation : montant amorti dans la période
 *   - cumul    : cumul depuis l'origine (incluant la période)
 *   - vnc      : valeur nette comptable à la clôture
 */

import type { NoteHandler, NoteRow } from '../types';

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export const handleN3dAmort: NoteHandler = async (ctx, deps) => {
  const assets = await deps.assets.findAllForExercise(ctx.organizationId, ctx.fiscalYear);
  const schedules = await deps.assets.findDepreciationForYear(
    ctx.organizationId,
    ctx.fiscalYear,
  );

  const assetById = new Map<string, (typeof assets)[number]>();
  for (const a of assets) assetById.set(a.id, a);

  const rows: NoteRow[] = [];
  let totDot = 0;
  let totCumul = 0;
  let totVnc = 0;

  for (const s of schedules) {
    const a = assetById.get(s.assetId);
    const label = a ? `${a.code} — ${a.label}` : `Asset ${s.assetId.slice(0, 8)}`;
    const dot = num(s.depreciationAmount);
    const cumul = num(s.cumulativeDepreciation);
    const vnc = num(s.netBookValue);
    totDot += dot;
    totCumul += cumul;
    totVnc += vnc;
    rows.push({
      key: s.assetId,
      label,
      values: {
        dotation: fmt(dot),
        cumul: fmt(cumul),
        vnc: fmt(vnc),
      },
    });
  }

  rows.push({
    key: 'TOTAL',
    label: 'TOTAL dotations de la période',
    values: {
      dotation: fmt(totDot),
      cumul: fmt(totCumul),
      vnc: fmt(totVnc),
    },
  });

  return { rows, applicable: schedules.length > 0 };
};
