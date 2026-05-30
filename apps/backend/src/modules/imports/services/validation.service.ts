import { Injectable } from '@nestjs/common';

import { getRequiredFieldsForDocumentType, type MappedRow } from '../types/mapping';
import type { DocumentType, ValidationError } from '../types/import-status';

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
  /**
   * Set OPTIONNEL de tous les codes connus du référentiel SYSCOHADA
   * AUDCIF (493 comptes après W1.1). Utilisé EXCLUSIVEMENT pour
   * proposer un compte parent lorsqu'un compte feuille importé ne
   * matche pas le chart de l'organisation (`unknown_account_with_parent_hint`).
   *
   * Si absent, le fallback hint est désactivé et `unknown_account`
   * classique est émis — comportement historique préservé.
   */
  readonly allReferenceCodes?: ReadonlySet<string>;
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
  /**
   * Nature du document importé. Pilote :
   *   - la liste des champs requis (voir
   *     `getRequiredFieldsForDocumentType`) ;
   *   - la règle débit/crédit : pour `trial_balance` / `general_ledger`
   *     un compte peut présenter à la fois un cumul débiteur ET un
   *     cumul créditeur, donc on autorise les deux simultanément ;
   *   - le downgrade de `unknown_account` en
   *     `unknown_account_with_parent_hint` quand un préfixe parent du
   *     référentiel SYSCOHADA matche (cas balance d'un fichier Sage).
   *
   * Défaut `entries` pour rétrocompat — toute session sans
   * `documentType` explicite garde le comportement historique.
   */
  readonly documentType?: DocumentType;
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
 * Équilibre par pièce : l'agrégation `somme débit = somme crédit` par
 * `(journal, pieceNumber)` est vérifiée au moment du COMMIT
 * (`ImportSessionService.collectUnbalancedGroups`), pas par ligne ici —
 * `pieceNumber` étant désormais obligatoire pour `entries`, chaque pièce
 * forme un groupe équilibré ou le commit est refusé.
 *
 * NON appliqué au MVP :
 *   - cohérence devise vs journal — sera ajouté quand `Currency` aura
 *     une entité dédiée.
 */
@Injectable()
export class ValidationService {
  validateRow(row: MappedRow, ctx: ValidationContext): ValidationError[] {
    const errors: ValidationError[] = [];
    const documentType: DocumentType = ctx.documentType ?? 'entries';
    const requiredFields = getRequiredFieldsForDocumentType(documentType);

    // 1. Required fields — depends on documentType so a Balance is not
    //    asked for a `journal` it physically cannot carry.
    for (const field of requiredFields) {
      const value = row[field];
      if (value === undefined || value === null || value.trim().length === 0) {
        errors.push({
          code: 'missing_required_field',
          message: `Le champ "${field}" est obligatoire`,
          field,
        });
      }
    }

    // 2. Account exists in chart. Pour `trial_balance`, on tente un
    //    fallback "préfixe parent" quand le compte feuille n'existe
    //    pas — fréquent quand un fichier Sage utilise un découpage à
    //    8 chiffres alors que l'org ne tient son plan qu'à 3-6 chiffres.
    const account = row.account?.trim();
    if (account !== undefined && account.length > 0) {
      // Réconciliation zéro-padding (Sage exporte souvent des codes étendus
      // à 8 chiffres : `40110000` = `4011`). Si le code, débarrassé de ses
      // zéros terminaux, matche EXACTEMENT un compte imputable du plan, il
      // est valide. On ne fusionne jamais un sous-compte dans son parent.
      const resolved = resolvePostingAccount(account, ctx.chart.postingCodes);
      if (resolved === null) {
        const allowParentHint =
          (documentType === 'trial_balance' || documentType === 'entries') &&
          ctx.chart.allReferenceCodes !== undefined;
        if (allowParentHint) {
          const parent = findParentAccountByPrefix(
            account,
            ctx.chart.postingCodes,
            ctx.chart.allReferenceCodes ?? new Set<string>(),
          );
          if (parent !== null) {
            errors.push({
              code: 'unknown_account_with_parent_hint',
              message: `Le compte "${account}" n'existe pas mais le compte parent "${parent}" est disponible — créez-le ou mappez sur "${parent}"`,
              field: 'account',
            });
          } else {
            errors.push({
              code: 'unknown_account',
              message: `Le compte "${account}" n'existe pas dans le plan comptable ou n'est pas un compte de mouvement`,
              field: 'account',
            });
          }
        } else {
          errors.push({
            code: 'unknown_account',
            message: `Le compte "${account}" n'existe pas dans le plan comptable ou n'est pas un compte de mouvement`,
            field: 'account',
          });
        }
      }
    }

    // 3 & 4. Date parsing + fiscal year check. Si la date n'est pas
    //    requise pour ce documentType, on skip totalement (un fichier
    //    Balance n'a pas de date par ligne).
    const dateRaw = row.date?.trim();
    const dateRequired = requiredFields.includes('date');
    if (dateRaw !== undefined && dateRaw.length > 0) {
      const parsed = parseImportDate(dateRaw);
      if (parsed === null) {
        errors.push({
          code: 'invalid_date',
          message: `Date "${dateRaw}" non reconnue (formats acceptés : YYYY-MM-DD, DD/MM/YYYY)`,
          field: 'date',
        });
      } else if (ctx.fiscalYear && dateRequired) {
        if (parsed < ctx.fiscalYear.startDate || parsed > ctx.fiscalYear.endDate) {
          errors.push({
            code: 'date_out_of_fiscal_year',
            message: `Date ${dateRaw} hors de l'exercice comptable`,
            field: 'date',
          });
        }
      }
    }

    // 4bis. Date d'échéance (optionnelle) : si fournie, elle doit être
    //    parseable. Pas de contrôle d'exercice — une échéance tombe
    //    légitimement après la clôture (créance/dette à recouvrer).
    const dueDateRaw = row.dueDate?.trim();
    if (dueDateRaw !== undefined && dueDateRaw.length > 0 && parseImportDate(dueDateRaw) === null) {
      errors.push({
        code: 'invalid_date',
        message: `Date d'échéance "${dueDateRaw}" non reconnue (formats acceptés : YYYY-MM-DD, DD/MM/YYYY)`,
        field: 'dueDate',
      });
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
      // Pour une balance ou un grand livre, un même compte présente
      // simultanément un cumul débiteur ET un cumul créditeur (c'est
      // la sémantique du document, pas une erreur). On garde
      // `debit_credit_both_zero` (ligne vide = suspect) sauf pour
      // balance où une ligne à 0/0 est juste un compte sans
      // mouvement — informatif, pas bloquant.
      const isCumulativeDocument =
        documentType === 'trial_balance' || documentType === 'general_ledger';
      if (d === 0 && c === 0) {
        if (!isCumulativeDocument) {
          errors.push({
            code: 'debit_credit_both_zero',
            message: 'Au moins un des montants débit ou crédit doit être > 0',
          });
        }
      } else if (d > 0 && c > 0) {
        if (!isCumulativeDocument) {
          errors.push({
            code: 'debit_credit_both_nonzero',
            message: 'Débit et crédit ne peuvent pas être simultanément > 0',
          });
        }
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
 *   - Numéro de série Excel (entier 1..80000), ex. `45658` → 2025-01-25.
 *     Cas fréquent quand l'utilisateur a converti un .xlsx en .csv sans
 *     reformater la colonne date — Excel sérialise alors la date comme
 *     un entier (jours depuis 1900-01-00, avec le bug de l'année
 *     bissextile 1900 hérité de Lotus 1-2-3).
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

  // Excel serial date (entier sans séparateur). Plage 1..80000 couvre
  // de 1900-01-01 à 2118-12-30, suffisamment large pour la durée de
  // vie de cette appli sans risquer de confondre un entier "ID" 5 avec
  // une date 1900-01-04.
  const serialMatch = /^(\d{1,5})$/.exec(trimmed);
  if (serialMatch) {
    const serial = Number(serialMatch[1]);
    if (serial >= 1 && serial <= 80000) {
      return excelSerialToDate(serial);
    }
  }

  return null;
}

/**
 * Convertit un numéro de série Excel en `Date` UTC.
 *
 * Détail subtil : Excel considère à tort que 1900 est bissextile (bug
 * historique). On compense en utilisant l'offset 25569 (= nombre de
 * jours entre 1900-01-01 et 1970-01-01 dans le calendrier Excel) qui
 * absorbe ce décalage pour toutes les dates >= 1900-03-01 — soit
 * l'écrasante majorité des fichiers comptables réels.
 */
function excelSerialToDate(serial: number): Date | null {
  const ms = (serial - 25569) * 86_400_000;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
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

/**
 * Cherche un compte parent connu (présent soit dans le chart de
 * l'organisation, soit dans le référentiel SYSCOHADA) en descendant le
 * code de la feuille vers la racine, préfixe par préfixe.
 *
 * Exemple — `account = "10100000"`, posting = {}, reference = {"101",
 * "10"} → renvoie `"101"` (le plus long préfixe matché gagne, mais on
 * s'arrête au premier match en descendant donc on prend le plus
 * spécifique disponible). Si rien ne matche, renvoie `null`.
 *
 * Exporté pour les tests — la logique de descente de préfixe mérite
 * une couverture isolée.
 */
export function findParentAccountByPrefix(
  account: string,
  postingCodes: ReadonlySet<string>,
  allReferenceCodes: ReadonlySet<string>,
): string | null {
  const trimmed = account.trim();
  if (trimmed.length < 2) return null;
  // Descendre du préfixe le plus long (account[0..n-1]) au plus court
  // (2 chars). Le premier match gagne — c'est le parent le plus
  // spécifique disponible, donc celui qui apportera le plus
  // d'information à l'utilisateur.
  for (let len = trimmed.length - 1; len >= 2; len -= 1) {
    const prefix = trimmed.slice(0, len);
    if (postingCodes.has(prefix) || allReferenceCodes.has(prefix)) {
      return prefix;
    }
  }
  return null;
}

/**
 * Réconcilie un code compte zéro-paddé vers le compte imputable réel du plan.
 *
 * Convention Sage : les codes sont fréquemment étendus à 8 chiffres par des
 * zéros terminaux (`4011` → `40110000`, `4452` → `44520000`). Le plan de
 * l'organisation tient ses codes en forme courte (SYSCOHADA : 3-4 chiffres),
 * d'où des `unknown_account` en masse.
 *
 * On retire UNIQUEMENT les zéros terminaux et on exige une correspondance
 * EXACTE avec un compte POSTING. On ne fusionne JAMAIS un sous-compte dans son
 * parent (ex. `60420000` → `6042` absent ne devient PAS `604`) : reclasser une
 * écriture dans un compte plus agrégé est une décision comptable, pas une
 * normalisation de format — un tel cas reste `unknown_account` (à l'org de
 * créer le compte, ou de le mapper explicitement).
 *
 * Renvoie le code imputable résolu, ou `null` si le compte est réellement
 * inconnu. Exporté pour les tests et la canonicalisation côté orchestrateur.
 */
export function resolvePostingAccount(
  account: string,
  postingCodes: ReadonlySet<string>,
): string | null {
  const trimmed = account.trim();
  if (trimmed.length === 0) return null;
  if (postingCodes.has(trimmed)) return trimmed;
  let candidate = trimmed;
  while (candidate.length > 1 && candidate.endsWith('0')) {
    candidate = candidate.slice(0, -1);
    if (postingCodes.has(candidate)) return candidate;
  }
  return null;
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
