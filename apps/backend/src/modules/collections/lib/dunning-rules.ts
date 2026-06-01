/**
 * Règles pures du recouvrement client (relances).
 *
 * Deux décisions métier isolées ici pour être testables sans I/O :
 *  1. `daysOverdue` — âge en jours d'une échéance à une date de référence.
 *  2. `agingBucket` — tranche d'ancienneté d'une créance (miroir des seuils
 *     de l'échéancier : 1-30 / 31-60 / 61-90 / +90).
 *  3. `dunningLevel` — palier de relance déduit du retard maximal d'un client.
 *
 * Les seuils de palier sont une convention de gestion (paramétrable plus tard).
 */

export type AgingBucket = 'notDue' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus' | 'noDueDate';

/**
 * Palier de relance :
 *  - `none`          : rien d'échu.
 *  - `reminder`      : rappel courtois (1-15 j de retard).
 *  - `first`         : 1re relance (16-45 j).
 *  - `second`        : 2e relance (46-90 j).
 *  - `formal_notice` : mise en demeure (> 90 j).
 */
export type DunningLevel = 'none' | 'reminder' | 'first' | 'second' | 'formal_notice';

const MS_PER_DAY = 86_400_000;

/**
 * Nombre de jours de retard d'une échéance `dueDate` (ISO `YYYY-MM-DD`) à la
 * date de référence `referenceDate`. Positif = en retard ; ≤ 0 = à échoir ou
 * échéance du jour. `null` si l'échéance est absente ou invalide.
 */
export function daysOverdue(dueDate: string | null, referenceDate: string): number | null {
  if (dueDate === null || dueDate.trim().length === 0) return null;
  const dueTime = Date.parse(`${dueDate.trim()}T00:00:00Z`);
  const refTime = Date.parse(`${referenceDate.trim()}T00:00:00Z`);
  if (!Number.isFinite(dueTime) || !Number.isFinite(refTime)) return null;
  return Math.floor((refTime - dueTime) / MS_PER_DAY);
}

/** Tranche d'ancienneté à partir du retard en jours (null → `noDueDate`). */
export function agingBucket(overdueDays: number | null): AgingBucket {
  if (overdueDays === null) return 'noDueDate';
  if (overdueDays <= 0) return 'notDue';
  if (overdueDays <= 30) return 'd1_30';
  if (overdueDays <= 60) return 'd31_60';
  if (overdueDays <= 90) return 'd61_90';
  return 'd90plus';
}

/** Palier de relance déduit du retard maximal observé pour un client. */
export function dunningLevel(maxOverdueDays: number | null): DunningLevel {
  if (maxOverdueDays === null || maxOverdueDays <= 0) return 'none';
  if (maxOverdueDays <= 15) return 'reminder';
  if (maxOverdueDays <= 45) return 'first';
  if (maxOverdueDays <= 90) return 'second';
  return 'formal_notice';
}

/** Libellé lisible (FR) d'un palier, pour l'UI et l'objet de la lettre. */
export function dunningLevelLabel(level: DunningLevel): string {
  switch (level) {
    case 'none':
      return 'Aucune relance';
    case 'reminder':
      return 'Rappel';
    case 'first':
      return '1re relance';
    case 'second':
      return '2e relance';
    case 'formal_notice':
      return 'Mise en demeure';
  }
}
