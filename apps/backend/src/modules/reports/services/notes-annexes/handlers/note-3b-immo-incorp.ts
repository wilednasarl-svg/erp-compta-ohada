/**
 * Note 3B — Immobilisations incorporelles : tableau de variation.
 *
 * Pendant de N3A pour la classe 21x (frais d'établissement, recherche
 * et développement, brevets et licences, logiciels, fonds commercial).
 * Le même mécanisme brut/amortissement/cessions s'applique avec un
 * découpage par sous-classe SYSCOHADA AUDCIF.
 */
import type { NoteDepreciationRecord, NoteHandler, NoteRow } from '../types';

const CATEGORIES: ReadonlyArray<{
  readonly prefix: string;
  readonly key: string;
  readonly label: string;
}> = [
  { prefix: '211', key: 'FRAIS_ETABLISSEMENT', label: "Frais d'établissement (211)" },
  { prefix: '212', key: 'CHARGES_A_REPARTIR', label: 'Charges à répartir (212)' },
  { prefix: '213', key: 'R_AND_D', label: 'Frais de recherche et développement (213)' },
  { prefix: '214', key: 'BREVETS_LICENCES', label: 'Brevets, licences, marques, droits assimilés (214)' },
  { prefix: '215', key: 'LOGICIELS', label: 'Logiciels et sites internet (215)' },
  { prefix: '216', key: 'FONDS_COMMERCIAL', label: 'Fonds commercial (216)' },
  { prefix: '217', key: 'INVESTISSEMENTS_BAIL', label: 'Investissements de création (217)' },
  { prefix: '218', key: 'AUTRES_INCORP', label: 'Autres droits et valeurs incorporelles (218)' },
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

export const handleN3bImmoIncorp: NoteHandler = async (ctx, deps) => {
  const assets = await deps.assets.findAllForExercise(ctx.organizationId, ctx.fiscalYear);
  const schedules = await deps.assets.findDepreciationForYear(ctx.organizationId, ctx.fiscalYear);

  const scheduleByAsset = new Map<string, NoteDepreciationRecord>();
  for (const s of schedules) scheduleByAsset.set(s.assetId, s);

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
    if (!cat) continue;
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
      bucket.cessions += cost;
    }

    const sched = scheduleByAsset.get(asset.id);
    if (sched) {
      bucket.dotation += num(sched.depreciationAmount);
      const cumul = num(sched.cumulativeDepreciation);
      const dot = num(sched.depreciationAmount);
      bucket.amortOuverture += cumul - dot;
      if (disposedInExercise) {
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
    label: 'TOTAL immobilisations incorporelles',
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

  const hasAnyMovement = rows.some(
    (r) =>
      r.key !== 'TOTAL' && (num(r.values.brutCloture) !== 0 || num(r.values.amortCloture) !== 0),
  );

  return { rows, applicable: hasAnyMovement };
};
