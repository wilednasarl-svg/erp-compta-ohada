/**
 * Note 27B — Effectifs, masse salariale et personnel extérieur
 * (Tome 3 p. 63).
 *
 * Doctrine : tableau des effectifs ventilés par qualification (codes
 * lettrés YA-YO). Source = profile DSF (R2) de l'organisation, déjà
 * saisi via `DsfIdentificationService.updateProfile`.
 *
 * Le handler lit le Record `workforceByQualification` du profile et
 * produit une ligne par qualification présente, plus un TOTAL. Si la
 * dépendance `dsfProfile` n'est pas câblée (ex. tests registry avec
 * deps vides), on rend un dataset vide marqué `applicable: true` pour
 * permettre la saisie texte libre.
 *
 * Codes de référence (Tome 3 p. 30, masse salariale) :
 *   YA Cadres / YB Maîtrise / YC Employés / YD Ouvriers /
 *   YE Apprentis / YF Personnel mis à disposition / etc.
 */
import type { NoteHandler, NoteRow } from '../types';

export const handleN27bEffectifs: NoteHandler = async (ctx, deps) => {
  if (!deps.dsfProfile) {
    return { rows: [], applicable: true };
  }

  const workforce = await deps.dsfProfile.getWorkforceByQualification(
    ctx.organizationId as string,
  );

  const entries = Object.entries(workforce).filter(
    ([, n]) => typeof n === 'number' && Number.isFinite(n),
  );

  if (entries.length === 0) {
    return { rows: [], applicable: true };
  }

  // Tri stable par clé (codes lettrés YA, YB, YC… : l'ordre alphabétique
  // respecte la nomenclature doctrinale).
  const sorted = [...entries].sort((a, b) => a[0].localeCompare(b[0]));

  let total = 0;
  const rows: NoteRow[] = sorted.map(([qualification, count]) => {
    total += count;
    return {
      key: qualification,
      label: qualification,
      values: {
        effectif: String(count),
      },
    };
  });

  rows.push({
    key: 'TOTAL',
    label: 'TOTAL effectif déclaré',
    values: { effectif: String(total) },
  });

  return { rows, applicable: true };
};
