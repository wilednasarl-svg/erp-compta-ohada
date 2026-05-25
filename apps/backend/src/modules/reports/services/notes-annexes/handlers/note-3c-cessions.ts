/**
 * Note 3C — Plus-values et moins-values de cession.
 *
 * Pour chaque asset cédé dans l'exercice :
 *   - prix de cession (`disposalValue`)
 *   - VNC à la date de cession (acquisitionCost − amortissements cumulés
 *     posted à date)
 *   - PV / MV = prix de cession − VNC
 *
 * SYSCOHADA : PV ⇒ compte 754 (produits cessions d'éléments d'actif),
 * MV ⇒ compte 654 (charges cessions). On agrège ici par asset puis
 * rend un total séparé PV et MV.
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

export const handleN3cCessions: NoteHandler = async (ctx, deps) => {
  const assets = await deps.assets.findAllForExercise(ctx.organizationId, ctx.fiscalYear);
  const schedules = await deps.assets.findDepreciationForYear(
    ctx.organizationId,
    ctx.fiscalYear,
  );

  const cumulByAsset = new Map<string, number>();
  for (const s of schedules) {
    cumulByAsset.set(s.assetId, num(s.cumulativeDepreciation));
  }

  const exerciseStart = ctx.periodStart;
  const exerciseEnd = ctx.periodEnd;

  const rows: NoteRow[] = [];
  let totalPv = 0;
  let totalMv = 0;

  for (const asset of assets) {
    if (asset.status !== 'disposed') continue;
    if (
      asset.disposalDate === null ||
      asset.disposalDate < exerciseStart ||
      asset.disposalDate > exerciseEnd
    ) {
      continue;
    }
    const prix = num(asset.disposalValue);
    const cost = num(asset.acquisitionCost);
    const cumul = cumulByAsset.get(asset.id) ?? 0;
    const vnc = cost - cumul;
    const result = prix - vnc; // > 0 : PV ; < 0 : MV
    if (result >= 0) totalPv += result;
    else totalMv += -result;
    rows.push({
      key: asset.code,
      label: asset.label,
      values: {
        prixCession: fmt(prix),
        vnc: fmt(vnc),
        plusValue: fmt(result > 0 ? result : 0),
        moinsValue: fmt(result < 0 ? -result : 0),
      },
    });
  }

  rows.push({
    key: 'TOTAL',
    label: 'TOTAL plus-values et moins-values',
    values: {
      prixCession: fmt(
        rows.reduce((s, r) => s + num(r.values.prixCession), 0),
      ),
      vnc: fmt(rows.reduce((s, r) => s + num(r.values.vnc), 0)),
      plusValue: fmt(totalPv),
      moinsValue: fmt(totalMv),
    },
  });

  return { rows, applicable: rows.length > 1 /* >TOTAL */ };
};
