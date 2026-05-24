import { Injectable } from '@nestjs/common';

import { REQUIRED_TARGET_FIELDS, type MappedRow } from '../types/mapping';
import type { ValidationError } from '../types/import-status';

/**
 * Référence partielle du plan comptable utilisée par `ValidationService`
 * pour vérifier qu'un compte cité dans une ligne importée existe bien
 * dans le chart de l'organisation. Volontairement minimal : on n'a
 * besoin que du `code` et du fait qu'il soit `POSTING` (seules les
 * feuilles peuvent recevoir une écriture).
 *
 * Le service ne charge PAS lui-même cette liste — c'est l'orchestrateur
 * (`ImportSessionService.preview`) qui la fournit, en appelant
 * `OrganizationAccountRepository.listByOrganization`. Garder la
 * dépendance "à la frontière" laisse `ValidationService` 100 % pur et
 * trivialement testable en unit.
 */
export interface ChartAccountIndex {
  /**
   * Set des codes `POSTING` actifs de l'organisation. La recherche est
   * O(1) en validation, ce qui compte sur un fichier 50 000 lignes.
   */
  readonly postingCodes: ReadonlySet<string>;
}

export interface FiscalYearRange {
  /** Inclus. */
  readonly startDate: Date;
  /** Inclus. */
  readonly endDate: Date;
}

export interface ValidationContext {
  readonly chart: ChartAccountIndex;
  /**
   * Si fourni, les dates en dehors de la plage produisent
   * `date_out_of_fiscal_year`. Si absent (Module 2 n'a pas encore
   * matérialisé `FiscalYear`), la règle est silencieusement skip.
   */
  readonly fiscalYear?: FiscalYearRange;
}

/**
 * `ValidationService` — vérifie une `MappedRow` contre les invariants
 * comptables OHADA minimaux pour le MVP.
 *
 * Règles appliquées par ligne :
 *
 *   1. champs requis (`account`, `journal`, `date`, `label`) présents
 *      et non vides → `missing_required_field`.
 *   2. `account` doit exister dans le plan de l'organisation comme
 *      compte POSTING → `unknown_account`.
 *   3. `date` doit être parseable au format `YYYY-MM-DD`,
 *      `DD/MM/YYYY` ou ISO complet → `invalid_date`.
 *   4. si `fiscalYear` fourni : la date doit tomber dans la plage →
 *      `date_out_of_fiscal_year`.
 *   5. `debit` et `credit` doivent être des nombres décimaux >= 0 →
 *      `invalid_amount` ou `negative_amount`.
 *   6. exactement UN des deux montants doit être > 0 (l'autre = 0 ou
 *      absent) → `debit_credit_both_zero` / `debit_credit_both_nonzero`.
 *
 * NON appliqué au MVP :
 *   - équilibre global d'une pièce (somme debit = somme credit) — exige
 *     un champ `piece_number` pas toujours présent dans les sources.
 *     Sera ajouté en Module 3 vague 2 si le besoin client le justifie.
 *   - cohérence devise vs journal — sera ajouté quand `Currency` aura
 *     une entité dédiée.
 */
@Injectable()
export class ValidationService {
  validateRow(row: MappedRow, ctx: ValidationContext): ValidationError[] {
    const errors: ValidationError[] = [];

    // 1. Required fields.
    for (const field of REQUIRED_TARGET_FIELDS) {
      const value = row[field];
      if (value === undefined || value === null || value.trim().length === 0) {
        errors.push({
          code: 'missing_required_field',
          message: `Le champ "${field}" est obligatoire`,
          field,
        });
      }
    }

    // 2. Account exists in chart.
    const account = row.account?.trim();
    if (account !== undefined && account.length > 0) {
      if (!ctx.chart.postingCodes.has(account)) {
        errors.push({
          code: 'unknown_account',
          message: `Le compte "${account}" n'existe pas dans le plan comptable ou n'est pas un compte de mouvement`,
          field: 'account',
        });
      }
    }

    // 3 & 4. Date parsing + fiscal year check.
    const dateRaw = row.date?.trim();
    if (dateRaw !== undefined && dateRaw.length > 0) {
      const parsed = parseImportDate(dateRaw);
      if (parsed === null) {
        errors.push({
          code: 'invalid_date',
          message: `Date "${dateRaw}" non reconnue (formats acceptés : YYYY-MM-DD, DD/MM/YYYY)`,
          field: 'date',
        });
      } else if (ctx.fiscalYear) {
        if (parsed < ctx.fiscalYear.startDate || parsed > ctx.fiscalYear.endDate) {
          errors.push({
            code: 'date_out_of_fiscal_year',
            message: `Date ${dateRaw} hors de l'exercice comptable`,
            field: 'date',
          });
        }
      }
    }

    // 5 & 6. Debit / credit amounts.
    const debit = parseAmount(row.debit);
    const credit = parseAmount(row.credit);

    if (debit.error) {
      errors.push({
        code: debit.error === 'negative' ? 'negative_amount' : 'invalid_amount',
        message:
          debit.error === 'negative'
            ? 'Le montant débit ne peut pas être négatif'
            : `Montant débit invalide ("${row.debit}")`,
        field: 'debit',
      });
    }
    if (credit.error) {
      errors.push({
        code: credit.error === 'negative' ? 'negative_amount' : 'invalid_amount',
        message:
          credit.error === 'negative'
            ? 'Le montant crédit ne peut pas être négatif'
            : `Montant crédit invalide ("${row.credit}")`,
        field: 'credit',
      });
    }

    if (!debit.error && !credit.error) {
      const d = debit.value;
      const c = credit.value;
      if (d === 0 && c === 0) {
        errors.push({
          code: 'debit_credit_both_zero',
          message: 'Au moins un des montants débit ou crédit doit être > 0',
        });
      } else if (d > 0 && c > 0) {
        errors.push({
          code: 'debit_credit_both_nonzero',
          message: 'Débit et crédit ne peuvent pas être simultanément > 0',
        });
      }
    }

    return errors;
  }

  /**
   * Construit un `ChartAccountIndex` à partir des comptes POSTING actifs
   * de l'organisation. Helper public pour éviter à chaque orchestrateur
   * de réécrire la même projection.
   */
  buildChartIndex(
    accounts: ReadonlyArray<{ code: string; accountType: 'POSTING' | 'TITLE'; isActive: boolean }>,
  ): ChartAccountIndex {
    const postingCodes = new Set<string>();
    for (const a of accounts) {
      if (a.accountType === 'POSTING' && a.isActive) {
        postingCodes.add(a.code);
      }
    }
    return { postingCodes };
  }
}

/**
 * Parse les formats de date les plus courants côté export comptable :
 *   - `YYYY-MM-DD`
 *   - `DD/MM/YYYY`
 *   - `DD-MM-YYYY`
 *   - ISO complet (`2024-03-15T00:00:00Z`)
 *
 * Renvoie `null` si aucune forme ne matche ou si la date résulte
 * invalide (ex. `31/02/2024`).
 *
 * Exporté pour les tests — la logique de date est suffisamment subtile
 * pour mériter sa propre couverture.
 */
export function parseImportDate(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // YYYY-MM-DD or ISO 8601
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return makeDate(year, month, day);
  }

  // DD/MM/YYYY or DD-MM-YYYY (FR convention)
  const frMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = Number(frMatch[2]);
    const year = Number(frMatch[3]);
    return makeDate(year, month, day);
  }

  return null;
}

function makeDate(year: number, month: number, day: number): Date | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject silently-rolled-over dates (e.g. 31/02 → 03/03).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

type AmountResult = { value: number; error: null } | { value: 0; error: 'invalid' | 'negative' };

/**
 * Parse un montant accepté en plusieurs notations :
 *   - virgule décimale FR : `"1234,56"` → `1234.56`
 *   - point décimal EN : `"1234.56"`
 *   - espaces de groupement : `"1 234,56"` → `1234.56`
 *   - vide / `null` / `undefined` → 0 (interprété comme "pas de montant")
 *
 * `'negative'` est distingué de `'invalid'` pour produire deux codes
 * d'erreur différents côté UI.
 */
function parseAmount(value: string | null | undefined): AmountResult {
  if (value === null || value === undefined) {
    return { value: 0, error: null };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { value: 0, error: null };
  }
  // Strip whitespace groupings, normalise all commas → dots. The /g flag
  // is defensive: a value like '1,234,56' (ambiguous between French
  // thousands and decimals) becomes '1.234.56' which fails the strict
  // single-dot regex below, so the row is flagged invalid rather than
  // silently mis-parsed if the regex is ever relaxed.
  const normalised = trimmed.replace(/\s/g, '').replace(/,/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) {
    return { value: 0, error: 'invalid' };
  }
  const num = Number(normalised);
  if (!Number.isFinite(num)) {
    return { value: 0, error: 'invalid' };
  }
  if (num < 0) {
    return { value: 0, error: 'negative' };
  }
  return { value: num, error: null };
}
