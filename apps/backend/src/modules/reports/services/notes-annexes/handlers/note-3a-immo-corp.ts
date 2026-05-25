/**
 * Note 3A — Immobilisations corporelles : tableau de variation.
 *
 * Tableau de mouvement par grande catégorie (terrains 22x, bâtiments
 * 23x, matériel 24x...) :
 *
 *   Brut ouverture
 *   + Acquisitions de l'exercice
 *   − Cessions / mises au rebut
 *   = Brut clôture
 *
 *   Amortissements ouverture
 *   + Dotation période
 *   − Reprises sur cessions
 *   = Amortissements clôture
 *
 *   VNC = Brut clôture − Amortissements clôture
 *
 * Source : `assets` filtré sur classe 22x..24x + `depreciation_schedules`
 * sur l'exercice. Les acquisitions sont les assets dont
 * `acquisitionDate` est dans l'exercice. Les cessions sont les assets
 * `disposed` dont `disposalDate` est dans l'exercice.
 */

import type { NoteDepreciationRecord, NoteHandler, NoteRow } from '../types';

/**
 * Catégories standards SYSCOHADA pour la note 3A.
 * Clé = prefix de compte ; valeur = libellé human-readable.
 */
const CATEGORIES: ReadonlyArray<{ readonly prefix: string; readonly key: string; readonly label: string }> = [
  { prefix: '22', key: 'TERRAINS', label: 'Terrains (22)' },
  { prefix: '23', key: 'CONSTRUCTIONS', label: 'Bâtiments et installations (23)' },
  { prefix: '24', key: 'MATERIEL', label: 'Matériel et mobilier (24)' },
];

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function categoryOf(accountCode: string): string | null {
  for (const cat of CATEGORIES) {
    if (accountCode.startsWith(cat.prefix)) return cat.key;
  }
  return null;
}

export const handleN3aImmoCorp: NoteHandler = async (ctx, deps) => {
  const assets = await deps.assets.findAllForExercise(ctx.organizationId, ctx.fiscalYear);
  const schedules = await deps.assets.findDepreciationForYear(
    ctx.organizationId,
    ctx.fiscalYear,
  );

  // Index schedules par assetId (un seul schedule par asset×année par construction).
  const scheduleByAsset = new Map<string, NoteDepreciationRecord>();
  for (const s of schedules) scheduleByAsset.set(s.assetId, s);

  // Buckets par catégorie.
  type Bucket = {
    brutOuverture: number;
    acquisitions: number;
    cessions: number;
    amortOuverture: number;
    dotation: number;
    repriseCessions: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const cat of CATEGORIES) {
    buckets.set(cat.key, {
      brutOuverture: 0,
      acquisitions: 0,
      cessions: 0,
      amortOuverture: 0,
      dotation: 0,
      repriseCessions: 0,
    });
  }

  const exerciseStart = ctx.periodStart;
  const exerciseEnd = ctx.periodEnd;

  for (const asset of assets) {
    const cat = categoryOf(asset.assetAccountCode);
    if (!cat) continue; // assets incorporels (21x) ignorés ici, traités en N3B
    const bucket = buckets.get(cat);
    if (!bucket) continue;

    const cost = num(asset.acquisitionCost);
    const acquiredInExercise =
      asset.acquisitionDate >= exerciseStart && asset.acquisitionDate <= exerciseEnd;
    const disposedInExercise: boolean =
      asset.status === 'disposed' &&
      asset.disposalDate !== null &&
      asset.disposalDate >= exerciseStart &&
      asset.disposalDate <= exerciseEnd;

    if (acquiredInExercise) {
      bucket.acquisitions += cost;
    } else {
      bucket.brutOuverture += cost;
    }

    if (disposedInExercise) {
      // L'asset disposé apparaît en cessions ; s'il avait aussi été
      // acquis dans l'exercice, c'est une acq+cession et il a déjà été
      // ajouté en acquisitions ci-dessus.
      bucket.cessions += cost;
    }

    const sched = scheduleByAsset.get(asset.id);
    if (sched) {
      bucket.dotation += num(sched.depreciationAmount);
      // Amort ouverture = cumulé - dotation période
      const cumul = num(sched.cumulativeDepreciation);
      const dot = num(sched.depreciationAmount);
      bucket.amortOuverture += cumul - dot;
      if (disposedInExercise) {
        // Reprise = amort cumulé à la cession (approx : cumul de l'année)
        bucket.repriseCessions += cumul;
      }
    }
  }

  const rows: NoteRow[] = CATEGORIES.map((cat) => {
    const b = buckets.get(cat.key)!;
    const brutCloture = b.brutOuverture + b.acquisitions - b.cessions;
    const amortCloture = b.amortOuverture + b.dotation - b.repriseCessions;
    const vnc = brutCloture - amortCloture;
    return {
      key: cat.key,
      label: cat.label,
      values: {
        brutOuverture: fmt(b.brutOuverture),
        acquisitions: fmt(b.acquisitions),
        cessions: fmt(b.cessions),
        brutCloture: fmt(brutCloture),
        amortOuverture: fmt(b.amortOuverture),
        dotation: fmt(b.dotation),
        repriseCessions: fmt(b.repriseCessions),
        amortCloture: fmt(amortCloture),
        vnc: fmt(vnc),
      },
    };
  });

  // Ligne TOTAL.
  const total = rows.reduce(
    (acc, r) => ({
      brutOuverture: acc.brutOuverture + num(r.values.brutOuverture),
      acquisitions: acc.acquisitions + num(r.values.acquisitions),
      cessions: acc.cessions + num(r.values.cessions),
      brutCloture: acc.brutCloture + num(r.values.brutCloture),
      amortOuverture: acc.amortOuverture + num(r.values.amortOuverture),
      dotation: acc.dotation + num(r.values.dotation),
      repriseCessions: acc.repriseCessions + num(r.values.repriseCessions),
      amortCloture: acc.amortCloture + num(r.values.amortCloture),
      vnc: acc.vnc + num(r.values.vnc),
    }),
    {
      brutOuverture: 0,
      acquisitions: 0,
      cessions: 0,
      brutCloture: 0,
      amortOuverture: 0,
      dotation: 0,
      repriseCessions: 0,
      amortCloture: 0,
      vnc: 0,
    },
  );

  rows.push({
    key: 'TOTAL',
    label: 'TOTAL immobilisations corporelles',
    values: {
      brutOuverture: fmt(total.brutOuverture),
      acquisitions: fmt(total.acquisitions),
      cessions: fmt(total.cessions),
      brutCloture: fmt(total.brutCloture),
      amortOuverture: fmt(total.amortOuverture),
      dotation: fmt(total.dotation),
      repriseCessions: fmt(total.repriseCessions),
      amortCloture: fmt(total.amortCloture),
      vnc: fmt(total.vnc),
    },
  });

  // Applicable seulement s'il y a au moins une ligne avec mouvement.
  const hasAnyMovement = rows.some(
    (r) =>
      r.key !== 'TOTAL' &&
      (num(r.values.brutCloture) !== 0 || num(r.values.amortCloture) !== 0),
  );

  return { rows, applicable: hasAnyMovement };
};

/** Helpers exportés pour les tests (assertion fine sur les sommes). */
export const __testing = { num, fmt, categoryOf };
