import type { DepreciationMethod, DerogatoryConfig } from '../types/asset.types';

/**
 * `DepreciationCalculator` — fonctions pures de calcul d'amortissement
 * SYSCOHADA. Aucun accès DB, aucun side-effect. Toute la logique métier
 * reproductible et testable en isolation. Le service côté NestJS se
 * limite à : (a) charger l'asset, (b) appeler ces fonctions, (c)
 * persister le résultat.
 *
 * Précision : on travaille en *cents* (multiplication par 100 + Math.round
 * en entrée, division par 100 en sortie) pour éviter les erreurs IEEE-754
 * sur la somme des dotations (la somme doit être exactement égale à
 * `acquisitionCost - residualValue`). On expose les nombres finaux en
 * `string` à 2 décimales pour préserver le contrat DECIMAL(15,2) DB.
 */

export interface DepreciationInput {
  /** Coût d'acquisition HT (string DECIMAL ou number). */
  readonly acquisitionCost: string | number;
  /** Valeur résiduelle attendue en fin d'amortissement. */
  readonly residualValue: string | number;
  /** Date de mise en service (YYYY-MM-DD) — point de départ de l'amortissement. */
  readonly putInServiceDate: string;
  /** Durée d'amortissement en mois (ex: 60 = 5 ans). */
  readonly durationMonths: number;
  /** Méthode SYSCOHADA. */
  readonly method: DepreciationMethod;
  /**
   * Taux dégressif annuel (ex: 0.4 pour 40 %). Requis si method='declining',
   * ignoré sinon. SYSCOHADA fixe ce taux en multipliant le taux linéaire
   * (= 1/n) par un coefficient légal (1,5 / 2 / 2,5 selon la durée).
   */
  readonly decliningRate?: string | number | null;
  /**
   * Bornes du premier exercice fiscal (YYYY-MM-DD). Par défaut, l'année
   * civile contenant `putInServiceDate`. Le service utilisera la
   * `AccountingPeriodRepository` pour calquer le fiscal year réel.
   */
  readonly firstFiscalYearStart?: string;
  readonly firstFiscalYearEnd?: string;
}

export interface DepreciationLine {
  /** Année fiscale (ex: 2026). */
  readonly fiscalYear: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Dotation de l'exercice, format string DECIMAL(15,2). */
  readonly depreciationAmount: string;
  /** Cumul des dotations à la fin de l'exercice. */
  readonly cumulativeDepreciation: string;
  /** Valeur nette comptable (= coût - cumul) en fin d'exercice. */
  readonly netBookValue: string;
}

const CENT = 100;

function toCents(v: string | number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid numeric value: ${String(v)}`);
  }
  // Math.round on cents to absorb IEEE-754 noise on user inputs like
  // 1234.567 → 123456.7 → 123457 cents.
  return Math.round(n * CENT);
}

function fromCents(cents: number): string {
  return (cents / CENT).toFixed(2);
}

function parseYmd(s: string): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Invalid YYYY-MM-DD date: ${s}`);
  }
  const parts = s.split('-').map(Number);
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function formatYmd(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Calcule le nombre de mois pleins entre deux dates inclusives, en
 * convention SYSCOHADA : un mois entamé compte pour un mois entier
 * SAUF si la mise en service est postérieure au 15 du mois (dans ce
 * cas, on ne compte pas le mois d'arrivée).
 *
 * Convention pragmatique adoptée wave 1 : prorata strict en jours
 * rapporté à l'année réelle (365 ou 366), ce qui est plus précis et
 * accepté par les commissaires aux comptes OHADA. Le mois entamé sera
 * supporté en wave 2 si un client le demande.
 */
function daysBetween(startYmd: string, endYmd: string): number {
  const s = Date.UTC(...(Object.values(parseYmd(startYmd)) as [number, number, number]));
  const e = Date.UTC(...(Object.values(parseYmd(endYmd)) as [number, number, number]));
  // Inclusive: +1 for the start day itself.
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

function daysInYear(year: number): number {
  return isLeap(year) ? 366 : 365;
}

/**
 * Construit les bornes (YYYY-01-01, YYYY-12-31) d'une année civile.
 * Si l'organisation utilise un fiscal year décalé (ex: 1er juillet),
 * passer firstFiscalYearStart/End explicitement.
 */
function calendarYearBounds(year: number): { start: string; end: string } {
  return {
    start: formatYmd(year, 1, 1),
    end: formatYmd(year, 12, 31),
  };
}

/**
 * Avance d'un fiscal year. Si le first year va du 2026-07-01 au
 * 2027-06-30 (décalé), le suivant est 2027-07-01 → 2028-06-30. Sinon
 * (année civile), on incrémente simplement l'année.
 */
function nextFiscalYear(prevStart: string, prevEnd: string): { start: string; end: string } {
  const ps = parseYmd(prevStart);
  const pe = parseYmd(prevEnd);
  const isCalendar = ps.month === 1 && ps.day === 1 && pe.month === 12 && pe.day === 31;
  if (isCalendar) {
    return calendarYearBounds(ps.year + 1);
  }
  // Décalé : on translate de +1 an sur les deux bornes (en gardant le
  // dernier jour du mois pour absorber bissextile sur 02-29 → 02-28).
  const newStart = formatYmd(ps.year + 1, ps.month, ps.day);
  const newEndMonth = pe.month;
  const newEndYear = pe.year + 1;
  const newEndDay = Math.min(pe.day, daysInMonth(newEndYear, newEndMonth));
  return { start: newStart, end: formatYmd(newEndYear, newEndMonth, newEndDay) };
}

function fiscalYearLabel(start: string): number {
  return parseYmd(start).year;
}

/**
 * Calcule l'échéancier complet d'une immobilisation en méthode
 * linéaire avec prorata journalier exact.
 *
 * Invariant: la somme des `depreciationAmount` est exactement égale à
 * `acquisitionCost - residualValue` (au cent près).
 *
 * Implémentation : on calcule chaque année la part de jours en service
 * sur la durée totale en jours, applique au montant amortissable, et
 * ajuste la dernière ligne pour absorber les arrondis cumulés (delta
 * <= nombre d'exercices cents).
 */
export function computeLinearSchedule(input: DepreciationInput): DepreciationLine[] {
  const cost = toCents(input.acquisitionCost);
  const residual = toCents(input.residualValue);
  const depreciable = cost - residual;
  if (depreciable <= 0) {
    throw new Error(
      `residualValue (${input.residualValue}) cannot exceed or equal acquisitionCost (${input.acquisitionCost})`,
    );
  }
  if (input.durationMonths <= 0) {
    throw new Error(`durationMonths must be > 0, got ${input.durationMonths}`);
  }

  const start = parseYmd(input.putInServiceDate);
  // End-of-amortization date = start + durationMonths - 1 day (inclusive).
  const lastDate = new Date(
    Date.UTC(start.year, start.month - 1 + input.durationMonths, start.day),
  );
  lastDate.setUTCDate(lastDate.getUTCDate() - 1);
  const finalEnd = formatYmd(
    lastDate.getUTCFullYear(),
    lastDate.getUTCMonth() + 1,
    lastDate.getUTCDate(),
  );

  const totalDays = daysBetween(input.putInServiceDate, finalEnd);

  const firstStart = input.firstFiscalYearStart ?? calendarYearBounds(start.year).start;
  const firstEnd = input.firstFiscalYearEnd ?? calendarYearBounds(start.year).end;

  const lines: Array<Omit<DepreciationLine, 'cumulativeDepreciation' | 'netBookValue'>> = [];
  let cursor = { start: firstStart, end: firstEnd };
  let allocatedCents = 0;
  let safety = 0;
  while (safety++ < 200) {
    // Intersection [putInService, finalEnd] ∩ [cursor.start, cursor.end].
    const segStart = cursor.start < input.putInServiceDate ? input.putInServiceDate : cursor.start;
    const segEnd = cursor.end > finalEnd ? finalEnd : cursor.end;
    if (segStart > segEnd) {
      // No overlap (e.g. asset already fully depreciated before this fiscal year).
      break;
    }
    const segDays = daysBetween(segStart, segEnd);
    // Pro-rata raw cents — keep as float, round at allocation time.
    const raw = (depreciable * segDays) / totalDays;
    let cents = Math.round(raw);
    // Cap so we never over-allocate.
    if (allocatedCents + cents > depreciable) {
      cents = depreciable - allocatedCents;
    }
    lines.push({
      fiscalYear: fiscalYearLabel(cursor.start),
      periodStart: cursor.start,
      periodEnd: cursor.end,
      depreciationAmount: fromCents(cents),
    });
    allocatedCents += cents;
    if (segEnd >= finalEnd) {
      // Last fiscal year — adjust for any rounding drift so cumul is exact.
      if (allocatedCents !== depreciable) {
        const delta = depreciable - allocatedCents;
        const last = lines[lines.length - 1];
        const adjusted = toCents(last.depreciationAmount) + delta;
        lines[lines.length - 1] = {
          ...last,
          depreciationAmount: fromCents(adjusted),
        };
        allocatedCents = depreciable;
      }
      break;
    }
    cursor = nextFiscalYear(cursor.start, cursor.end);
  }
  if (safety >= 200) {
    throw new Error('computeLinearSchedule safety break — runaway loop');
  }

  // Second pass: cumulative + NBV.
  let cumul = 0;
  return lines.map((l) => {
    cumul += toCents(l.depreciationAmount);
    return {
      ...l,
      cumulativeDepreciation: fromCents(cumul),
      netBookValue: fromCents(cost - cumul),
    };
  });
}

/**
 * Amortissement dégressif SYSCOHADA. Le taux dégressif est appliqué à
 * la valeur nette comptable en début d'exercice. On bascule sur
 * linéaire dès que la dotation linéaire (calculée sur la VNC résiduelle
 * répartie sur les années restantes) devient supérieure à la dotation
 * dégressive. Prorata journalier sur le premier exercice.
 *
 * Invariant: somme des dotations = depreciable (au cent près).
 */
export function computeDecliningSchedule(input: DepreciationInput): DepreciationLine[] {
  if (input.decliningRate === null || input.decliningRate === undefined) {
    throw new Error('decliningRate is required for declining method');
  }
  const rate =
    typeof input.decliningRate === 'number' ? input.decliningRate : Number(input.decliningRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
    throw new Error(`decliningRate must be in (0, 1), got ${input.decliningRate}`);
  }

  const cost = toCents(input.acquisitionCost);
  const residual = toCents(input.residualValue);
  const depreciable = cost - residual;
  if (depreciable <= 0) {
    throw new Error('residualValue cannot exceed or equal acquisitionCost');
  }

  const start = parseYmd(input.putInServiceDate);
  const firstStart = input.firstFiscalYearStart ?? calendarYearBounds(start.year).start;
  const firstEnd = input.firstFiscalYearEnd ?? calendarYearBounds(start.year).end;

  const lines: Array<Omit<DepreciationLine, 'cumulativeDepreciation' | 'netBookValue'>> = [];
  let cursor = { start: firstStart, end: firstEnd };
  let remaining = depreciable;
  const totalYears = Math.ceil(input.durationMonths / 12);
  let yearIndex = 0;
  let safety = 0;
  while (remaining > 0 && safety++ < 200) {
    yearIndex += 1;
    const segStart = cursor.start < input.putInServiceDate ? input.putInServiceDate : cursor.start;
    const segEnd = cursor.end;
    if (segStart > segEnd) {
      cursor = nextFiscalYear(cursor.start, cursor.end);
      continue;
    }
    const yearDays = daysInYear(parseYmd(segStart).year);
    const segDays = daysBetween(segStart, segEnd);
    // Dégressif annuel : taux × VNC début × prorata du temps en service.
    const decliningAnnual = remaining * rate;
    const declining = (decliningAnnual * segDays) / yearDays;
    // Linéaire sur années restantes.
    const yearsLeft = Math.max(1, totalYears - yearIndex + 1);
    const linearAnnual = remaining / yearsLeft;
    const linear = (linearAnnual * segDays) / yearDays;
    const dotation = Math.round(Math.max(declining, linear));
    const capped = Math.min(dotation, remaining);
    lines.push({
      fiscalYear: fiscalYearLabel(cursor.start),
      periodStart: cursor.start,
      periodEnd: cursor.end,
      depreciationAmount: fromCents(capped),
    });
    remaining -= capped;
    cursor = nextFiscalYear(cursor.start, cursor.end);
  }
  if (safety >= 200) {
    throw new Error('computeDecliningSchedule safety break — runaway loop');
  }
  // Drift correction on last line (rounding mismatch with `depreciable`).
  const allocated = lines.reduce((s, l) => s + toCents(l.depreciationAmount), 0);
  if (allocated !== depreciable && lines.length > 0) {
    const delta = depreciable - allocated;
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = {
      ...last,
      depreciationAmount: fromCents(toCents(last.depreciationAmount) + delta),
    };
  }

  let cumul = 0;
  return lines.map((l) => {
    cumul += toCents(l.depreciationAmount);
    return {
      ...l,
      cumulativeDepreciation: fromCents(cumul),
      netBookValue: fromCents(cost - cumul),
    };
  });
}

// ─── SOFTY (Sum-Of-The-Years' Digits) ───────────────────────────────────

/**
 * Amortissement SOFTY (Tome 2 chap 4-5, App. 27-32 SYSCOHADA).
 * Annuité année N = base × (durée − N + 1) / Σ(1..durée).
 * Exemple : 5 ans / 100k → 33333.33, 26666.67, 20000, 13333.33, 6666.67.
 * Prorata 1er exercice via fragmentation des paliers (alpha = jours en
 * service / jours dans l'année). Invariant : Σ = depreciable.
 */
export function computeSoftySchedule(input: DepreciationInput): DepreciationLine[] {
  const cost = toCents(input.acquisitionCost);
  const residual = toCents(input.residualValue);
  const depreciable = cost - residual;
  if (depreciable <= 0) {
    throw new Error(`residualValue (${input.residualValue}) cannot exceed or equal acquisitionCost (${input.acquisitionCost})`);
  }
  if (input.durationMonths <= 0) {
    throw new Error(`durationMonths must be > 0, got ${input.durationMonths}`);
  }

  const totalYears = Math.ceil(input.durationMonths / 12);
  const sumOfDigits = (totalYears * (totalYears + 1)) / 2;
  const fullAnnuities: number[] = [];
  for (let i = 0; i < totalYears; i++) {
    const weight = totalYears - i;
    fullAnnuities.push(Math.round((depreciable * weight) / sumOfDigits));
  }

  const start = parseYmd(input.putInServiceDate);
  const firstStart = input.firstFiscalYearStart ?? calendarYearBounds(start.year).start;
  const firstEnd = input.firstFiscalYearEnd ?? calendarYearBounds(start.year).end;
  const fiscalDaysYear1 = daysBetween(input.putInServiceDate, firstEnd);
  const yearDays = daysInYear(start.year);
  const alpha = fiscalDaysYear1 / yearDays;

  const lines: Array<Omit<DepreciationLine, 'cumulativeDepreciation' | 'netBookValue'>> = [];
  let cursor = { start: firstStart, end: firstEnd };
  const exerciseCount = alpha >= 1 ? totalYears : totalYears + 1;
  for (let i = 0; i < exerciseCount; i++) {
    let cents = 0;
    if (alpha >= 1) {
      cents = fullAnnuities[i];
    } else if (i === 0) {
      cents = Math.round(fullAnnuities[0] * alpha);
    } else if (i < totalYears) {
      cents = Math.round(fullAnnuities[i - 1] * (1 - alpha)) + Math.round(fullAnnuities[i] * alpha);
    } else {
      cents = Math.round(fullAnnuities[totalYears - 1] * (1 - alpha));
    }
    lines.push({
      fiscalYear: fiscalYearLabel(cursor.start),
      periodStart: cursor.start,
      periodEnd: cursor.end,
      depreciationAmount: fromCents(cents),
    });
    cursor = nextFiscalYear(cursor.start, cursor.end);
  }

  const allocated = lines.reduce((s, l) => s + toCents(l.depreciationAmount), 0);
  if (allocated !== depreciable && lines.length > 0) {
    const delta = depreciable - allocated;
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = {
      ...last,
      depreciationAmount: fromCents(toCents(last.depreciationAmount) + delta),
    };
  }

  let cumul = 0;
  return lines.map((l) => {
    cumul += toCents(l.depreciationAmount);
    return {
      ...l,
      cumulativeDepreciation: fromCents(cumul),
      netBookValue: fromCents(cost - cumul),
    };
  });
}

// ─── Units of Production (UOP) ──────────────────────────────────────────

export interface UopScheduleInput extends DepreciationInput {
  readonly totalUnits: number;
  readonly unitsPerYear: ReadonlyArray<number>;
}

export class UopUnitsRequiredError extends Error {
  readonly code = 'ASSET_UOP_UNITS_REQUIRED';
  constructor(message = 'totalUnits and non-empty unitsPerYear are required for UOP method') {
    super(message);
  }
}
export class UopUnitsOverflowError extends Error {
  readonly code = 'ASSET_UOP_UNITS_OVERFLOW';
  constructor(message = 'sum(unitsPerYear) must not exceed totalUnits') {
    super(message);
  }
}

/**
 * Dotation N = base × (unitsPerYear[N] / totalUnits). Si sum < total,
 * le bien n'est pas totalement amorti (VNC > residual maintenue).
 */
export function computeUnitsOfProductionSchedule(input: UopScheduleInput): DepreciationLine[] {
  if (!input.totalUnits || input.totalUnits <= 0 || !input.unitsPerYear || input.unitsPerYear.length === 0) {
    throw new UopUnitsRequiredError();
  }
  const sumUnits = input.unitsPerYear.reduce((s, u) => s + (Number(u) || 0), 0);
  if (sumUnits - input.totalUnits > 0.5) {
    throw new UopUnitsOverflowError(`sum(unitsPerYear)=${sumUnits} exceeds totalUnits=${input.totalUnits}`);
  }

  const cost = toCents(input.acquisitionCost);
  const residual = toCents(input.residualValue);
  const depreciable = cost - residual;
  if (depreciable <= 0) {
    throw new Error('residualValue cannot exceed or equal acquisitionCost');
  }

  const start = parseYmd(input.putInServiceDate);
  const firstStart = input.firstFiscalYearStart ?? calendarYearBounds(start.year).start;
  const firstEnd = input.firstFiscalYearEnd ?? calendarYearBounds(start.year).end;

  const lines: Array<Omit<DepreciationLine, 'cumulativeDepreciation' | 'netBookValue'>> = [];
  let cursor = { start: firstStart, end: firstEnd };
  for (let i = 0; i < input.unitsPerYear.length; i++) {
    const units = Math.max(0, Number(input.unitsPerYear[i]) || 0);
    const cents = Math.round((depreciable * units) / input.totalUnits);
    lines.push({
      fiscalYear: fiscalYearLabel(cursor.start),
      periodStart: cursor.start,
      periodEnd: cursor.end,
      depreciationAmount: fromCents(cents),
    });
    cursor = nextFiscalYear(cursor.start, cursor.end);
  }

  const allocated = lines.reduce((s, l) => s + toCents(l.depreciationAmount), 0);
  const isFullyUsed = Math.abs(sumUnits - input.totalUnits) < 0.5;
  if (isFullyUsed && allocated !== depreciable && lines.length > 0) {
    const delta = depreciable - allocated;
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = {
      ...last,
      depreciationAmount: fromCents(toCents(last.depreciationAmount) + delta),
    };
  }

  let cumul = 0;
  return lines.map((l) => {
    cumul += toCents(l.depreciationAmount);
    return {
      ...l,
      cumulativeDepreciation: fromCents(cumul),
      netBookValue: fromCents(cost - cumul),
    };
  });
}

// ─── Amortissements dérogatoires (R34 doctrine SYSCOHADA) ───────────────

export interface DerogatoryScheduleEntry {
  readonly fiscalYear: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly economicAmount: string;
  readonly fiscalAmount: string;
  readonly dotationAmount: string;
  readonly repriseAmount: string;
}

export interface DerogatoryInput {
  readonly acquisitionCost: string | number;
  readonly residualValue: string | number;
  readonly putInServiceDate: string;
  readonly durationMonths: number;
  readonly derogatory: DerogatoryConfig;
  readonly decliningRate?: string | number | null;
  readonly totalUnits?: number;
  readonly unitsPerYear?: ReadonlyArray<number>;
  readonly firstFiscalYearStart?: string;
  readonly firstFiscalYearEnd?: string;
}

export class DerogatoryConfigInvalidError extends Error {
  readonly code = 'ASSET_DEROGATORY_CONFIG_INVALID';
  constructor(message = 'derogatory configuration is invalid') {
    super(message);
  }
}

function buildScheduleForMethod(
  method: DepreciationMethod,
  base: Omit<DepreciationInput, 'method'>,
  decliningRate: string | number | null | undefined,
  uop?: { totalUnits?: number; unitsPerYear?: ReadonlyArray<number> },
): DepreciationLine[] {
  switch (method) {
    case 'linear':
      return computeLinearSchedule({ ...base, method: 'linear' });
    case 'declining':
      return computeDecliningSchedule({ ...base, method: 'declining', decliningRate });
    case 'softy':
      return computeSoftySchedule({ ...base, method: 'softy' });
    case 'units_of_production':
      if (!uop || !uop.totalUnits || !uop.unitsPerYear) {
        throw new UopUnitsRequiredError();
      }
      return computeUnitsOfProductionSchedule({
        ...base,
        method: 'units_of_production',
        totalUnits: uop.totalUnits,
        unitsPerYear: uop.unitsPerYear,
      });
  }
}

/**
 * Différence fiscal − économique par exercice :
 *   > 0 → dotation provision réglementée (D 851 / C 151)
 *   < 0 → reprise (D 151 / C 861)
 * Σ dotation − Σ reprise = 0 sur la durée totale.
 */
export function computeDerogatorySchedule(input: DerogatoryInput): DerogatoryScheduleEntry[] {
  const cfg = input.derogatory;
  if (!cfg.enabled) {
    throw new DerogatoryConfigInvalidError('derogatory.enabled must be true');
  }
  if (!cfg.economicMethod || !cfg.fiscalMethod) {
    throw new DerogatoryConfigInvalidError('derogatory.fiscalMethod and economicMethod are both required');
  }
  if (cfg.fiscalMethod === 'declining' && (cfg.fiscalDecliningRate === null || cfg.fiscalDecliningRate === undefined)) {
    throw new DerogatoryConfigInvalidError('fiscalDecliningRate required when fiscalMethod=declining');
  }

  const baseEconomic: Omit<DepreciationInput, 'method'> = {
    acquisitionCost: input.acquisitionCost,
    residualValue: input.residualValue,
    putInServiceDate: input.putInServiceDate,
    durationMonths: input.durationMonths,
    firstFiscalYearStart: input.firstFiscalYearStart,
    firstFiscalYearEnd: input.firstFiscalYearEnd,
  };
  const baseFiscal: Omit<DepreciationInput, 'method'> = {
    ...baseEconomic,
    durationMonths: cfg.fiscalDuration ?? input.durationMonths,
  };

  const economicLines = buildScheduleForMethod(cfg.economicMethod, baseEconomic, input.decliningRate, {
    totalUnits: input.totalUnits,
    unitsPerYear: input.unitsPerYear,
  });
  const fiscalLines = buildScheduleForMethod(cfg.fiscalMethod, baseFiscal, cfg.fiscalDecliningRate ?? input.decliningRate, {
    totalUnits: input.totalUnits,
    unitsPerYear: input.unitsPerYear,
  });

  const yearMap = new Map<number, { periodStart: string; periodEnd: string; economic: number; fiscal: number }>();
  for (const l of economicLines) {
    yearMap.set(l.fiscalYear, {
      periodStart: l.periodStart,
      periodEnd: l.periodEnd,
      economic: toCents(l.depreciationAmount),
      fiscal: 0,
    });
  }
  for (const l of fiscalLines) {
    const existing = yearMap.get(l.fiscalYear);
    if (existing) {
      existing.fiscal = toCents(l.depreciationAmount);
    } else {
      yearMap.set(l.fiscalYear, {
        periodStart: l.periodStart,
        periodEnd: l.periodEnd,
        economic: 0,
        fiscal: toCents(l.depreciationAmount),
      });
    }
  }

  const sortedYears = [...yearMap.keys()].sort((a, b) => a - b);
  return sortedYears.map((year) => {
    const row = yearMap.get(year)!;
    const diff = row.fiscal - row.economic;
    const dotation = diff > 0 ? diff : 0;
    const reprise = diff < 0 ? -diff : 0;
    return {
      fiscalYear: year,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      economicAmount: fromCents(row.economic),
      fiscalAmount: fromCents(row.fiscal),
      dotationAmount: fromCents(dotation),
      repriseAmount: fromCents(reprise),
    };
  });
}

/** Dispatch sur la méthode déclarée. */
export function computeSchedule(input: DepreciationInput): DepreciationLine[] {
  switch (input.method) {
    case 'linear':
      return computeLinearSchedule(input);
    case 'declining':
      return computeDecliningSchedule(input);
    case 'softy':
      return computeSoftySchedule(input);
    case 'units_of_production':
      throw new UopUnitsRequiredError('computeSchedule cannot dispatch UOP — use computeUnitsOfProductionSchedule with totalUnits + unitsPerYear');
  }
}

/**
 * Calcule la dotation d'amortissement sur une portion d'exercice
 * (W3.3 — prorata cession). On part de la dotation annuelle pleine
 * applicable au fragment d'exercice [fromDate, toDate] et on rapporte
 * au nombre de jours réellement courus.
 *
 * Convention :
 *   - linéaire : dotation pleine d'exercice = `(coût - résiduel) /
 *     totalDays × yearDays`. On peut directement réutiliser ce ratio en
 *     rapportant aux jours du segment.
 *   - dégressif : on applique `rate × VNC_début` proratisé en jours, ce
 *     qui suffit pour la dotation prorata cession (la VNC de début est
 *     calculée par le caller à partir du cumul amortissement passé).
 *
 * `fromDate` inclusif, `toDate` inclusif (convention SYSCOHADA jours).
 * Renvoie `0.00` si le segment est vide ou si le bien est totalement
 * amorti avant `fromDate` (caller responsable de la VNC d'entrée).
 *
 * NB : on retourne aussi `daysProrated` pour traçabilité (audit, lignes
 * d'écriture mentionnant la fraction d'année).
 */
export interface PartialYearDepreciationInput extends DepreciationInput {
  /** Cumul d'amortissement déjà passé (cents/DECIMAL string) — utile en dégressif. */
  readonly accumulatedDepreciation?: string | number;
}

export function computePartialYearDepreciation(
  input: PartialYearDepreciationInput,
  fromDate: string,
  toDate: string,
): { amount: string; daysProrated: number } {
  if (fromDate > toDate) {
    return { amount: '0.00', daysProrated: 0 };
  }
  const cost = toCents(input.acquisitionCost);
  const residual = toCents(input.residualValue);
  const depreciable = cost - residual;
  if (depreciable <= 0) {
    return { amount: '0.00', daysProrated: 0 };
  }
  if (input.durationMonths <= 0) {
    throw new Error(`durationMonths must be > 0, got ${input.durationMonths}`);
  }

  const segDays = daysBetween(fromDate, toDate);
  if (segDays <= 0) {
    return { amount: '0.00', daysProrated: 0 };
  }

  if (input.method === 'softy' || input.method === 'units_of_production') {
    const yearDays = daysInYear(parseYmd(fromDate).year);
    const totalYears = Math.ceil(input.durationMonths / 12);
    const annualEstimate = depreciable / totalYears;
    const cents = Math.round((annualEstimate * segDays) / yearDays);
    return { amount: fromCents(Math.min(cents, depreciable)), daysProrated: segDays };
  }

  if (input.method === 'linear') {
    // Total days of amortization, computed identically to computeLinearSchedule.
    const start = parseYmd(input.putInServiceDate);
    const lastDate = new Date(
      Date.UTC(start.year, start.month - 1 + input.durationMonths, start.day),
    );
    lastDate.setUTCDate(lastDate.getUTCDate() - 1);
    const finalEnd = formatYmd(
      lastDate.getUTCFullYear(),
      lastDate.getUTCMonth() + 1,
      lastDate.getUTCDate(),
    );
    // Cap segment to the amortization window.
    const effectiveStart = fromDate < input.putInServiceDate ? input.putInServiceDate : fromDate;
    const effectiveEnd = toDate > finalEnd ? finalEnd : toDate;
    if (effectiveStart > effectiveEnd) {
      return { amount: '0.00', daysProrated: 0 };
    }
    const effDays = daysBetween(effectiveStart, effectiveEnd);
    const totalDays = daysBetween(input.putInServiceDate, finalEnd);
    const cents = Math.round((depreciable * effDays) / totalDays);
    return { amount: fromCents(cents), daysProrated: effDays };
  }

  // Declining : taux × VNC début × prorata jours / jours dans l'année du segment.
  if (input.decliningRate === null || input.decliningRate === undefined) {
    throw new Error('decliningRate is required for declining method');
  }
  const rate =
    typeof input.decliningRate === 'number' ? input.decliningRate : Number(input.decliningRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
    throw new Error(`decliningRate must be in (0, 1), got ${input.decliningRate}`);
  }
  const accumulated = input.accumulatedDepreciation
    ? toCents(input.accumulatedDepreciation)
    : 0;
  const vncStart = Math.max(0, cost - residual - accumulated);
  if (vncStart <= 0) {
    return { amount: '0.00', daysProrated: segDays };
  }
  const yearDays = daysInYear(parseYmd(fromDate).year);
  const cents = Math.round((vncStart * rate * segDays) / yearDays);
  const capped = Math.min(cents, vncStart);
  return { amount: fromCents(capped), daysProrated: segDays };
}
