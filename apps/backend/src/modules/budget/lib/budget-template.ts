import {
  BUDGET_SCENARIOS,
  BUDGET_TYPES,
  DEFAULT_BUDGET_CURRENCY,
  type BudgetScenario,
  type BudgetType,
} from '../types/budget.types';

/**
 * Contrat du template d'import/export budgétaire (format plat §7.1).
 *
 * Les opérationnels remplissent les axes analytiques par CODE (ex. `COMM`,
 * `PRJ-2026-001`), jamais par UUID — la résolution code → id se fait à
 * l'import côté service. Les en-têtes acceptent plusieurs alias (FR/EN) pour
 * tolérer les classeurs remaniés.
 */

/** Ordre canonique des colonnes à l'export. */
export const BUDGET_TEMPLATE_HEADERS: readonly string[] = [
  'exercice',
  'periode',
  'type_budget',
  'scenario',
  'code_compte',
  'libelle_compte',
  'code_cc',
  'code_projet',
  'code_agence',
  'code_produit',
  'montant_budgete',
  'devise',
  'taux_change',
  'commentaire',
  'hypothese',
];

/** Champ canonique → alias d'en-tête acceptés (normalisés). */
const HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  exercice: ['exercice', 'annee', 'year', 'fiscal_year'],
  periode: ['periode', 'period', 'mois', 'month'],
  type_budget: ['type_budget', 'typebudget', 'type', 'budget_type'],
  scenario: ['scenario', 'scenarii', 'version'],
  code_compte: ['code_compte', 'compte', 'account_code', 'account'],
  libelle_compte: ['libelle_compte', 'libelle', 'account_label', 'label'],
  code_cc: ['code_cc', 'code_analytique', 'centre_de_cout', 'cost_center', 'cc'],
  code_projet: ['code_projet', 'projet', 'project'],
  code_agence: ['code_agence', 'agence', 'agency', 'site'],
  code_produit: ['code_produit', 'produit', 'product'],
  montant_budgete: ['montant_budgete', 'montant', 'amount', 'budget'],
  devise: ['devise', 'currency', 'monnaie'],
  taux_change: ['taux_change', 'taux', 'exchange_rate', 'rate', 'fx'],
  commentaire: ['commentaire', 'comment', 'note'],
  hypothese: ['hypothese', 'hypotheses', 'hypothesis', 'assumption'],
};

/** Normalise un en-tête : minuscules, sans accents, espaces/tirets → `_`. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

/** Construit la table en-tête-normalisé → champ canonique. */
export function buildHeaderMap(rawHeaders: readonly string[]): Map<string, string> {
  const reverse = new Map<string, string>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) reverse.set(alias, field);
  }
  const map = new Map<string, string>();
  for (const raw of rawHeaders) {
    const field = reverse.get(normalizeHeader(raw));
    if (field) map.set(raw, field);
  }
  return map;
}

/** Ligne normalisée prête à l'upsert (axes par CODE, pas par id). */
export interface ParsedTemplateRow {
  readonly fiscalYear: number;
  readonly periodMonth: number | null;
  readonly budgetType: BudgetType;
  readonly scenario: BudgetScenario;
  readonly accountCode: string;
  readonly accountLabel: string | null;
  readonly costCenterCode: string | null;
  readonly projectCode: string | null;
  readonly agencyCode: string | null;
  readonly productCode: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly exchangeRate: string;
  readonly comment: string | null;
  readonly hypothesis: string | null;
}

export type RawRecord = Readonly<Record<string, unknown>>;

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** Parse "2026-03", "2026/3", "3" ou "" → mois 1..12 ou null (annuel). */
function parsePeriod(raw: string, errors: string[]): number | null {
  if (raw === '') return null;
  const monthMatch = /^(?:\d{4}[-/])?(\d{1,2})$/.exec(raw);
  if (!monthMatch) {
    errors.push(`Période invalide "${raw}" (attendu AAAA-MM, le mois 1-12, ou vide)`);
    return null;
  }
  const month = Number(monthMatch[1]);
  if (month < 1 || month > 12) {
    errors.push(`Mois hors plage "${raw}" (1-12)`);
    return null;
  }
  return month;
}

/**
 * Mappe une ligne brute (en-tête → valeur) en ligne normalisée. Fonction
 * PURE : retourne soit `{ row }`, soit `{ errors }` (liste non vide). Aucune
 * résolution d'axe ni accès base — c'est le rôle du service.
 */
export function mapTemplateRow(
  record: RawRecord,
  headerMap: Map<string, string>,
): { row: ParsedTemplateRow } | { errors: string[] } {
  const errors: string[] = [];
  const get = (field: string): string => {
    for (const [rawHeader, canonical] of headerMap) {
      if (canonical === field) return str(record[rawHeader]);
    }
    return '';
  };

  const fiscalYearRaw = get('exercice');
  const fiscalYear = Number(fiscalYearRaw);
  if (!/^\d{4}$/.test(fiscalYearRaw) || fiscalYear < 2000 || fiscalYear > 2200) {
    errors.push(`Exercice invalide "${fiscalYearRaw}" (attendu AAAA, 2000-2200)`);
  }

  const periodMonth = parsePeriod(get('periode'), errors);

  const budgetType = get('type_budget').toUpperCase() as BudgetType;
  if (!(BUDGET_TYPES as readonly string[]).includes(budgetType)) {
    errors.push(`Type budget invalide "${get('type_budget')}" (OPEX/CAPEX/TRESO/RH)`);
  }

  const scenarioRaw = get('scenario').toUpperCase();
  const scenario = (scenarioRaw === '' ? 'BI' : scenarioRaw) as BudgetScenario;
  if (!(BUDGET_SCENARIOS as readonly string[]).includes(scenario)) {
    errors.push(`Scénario invalide "${scenarioRaw}" (BI/BR/REAL)`);
  }

  const accountCode = get('code_compte');
  if (!/^\d{1,12}$/.test(accountCode)) {
    errors.push(`Compte invalide "${accountCode}" (1-12 chiffres)`);
  }

  const amountRaw = get('montant_budgete').replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d{1,16}(\.\d{1,2})?$/.test(amountRaw)) {
    errors.push(`Montant invalide "${get('montant_budgete')}"`);
  }

  const currencyRaw = get('devise').toUpperCase();
  const currency = currencyRaw === '' ? DEFAULT_BUDGET_CURRENCY : currencyRaw;
  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push(`Devise invalide "${currencyRaw}" (ISO 4217)`);
  }

  const rateRaw = get('taux_change').replace(/\s/g, '').replace(',', '.');
  const exchangeRate = rateRaw === '' ? '1' : rateRaw;
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(exchangeRate)) {
    errors.push(`Taux de change invalide "${rateRaw}"`);
  }

  if (errors.length > 0) return { errors };

  const nullable = (v: string): string | null => (v === '' ? null : v);

  return {
    row: {
      fiscalYear,
      periodMonth,
      budgetType,
      scenario,
      accountCode,
      accountLabel: nullable(get('libelle_compte')),
      costCenterCode: nullable(get('code_cc')),
      projectCode: nullable(get('code_projet')),
      agencyCode: nullable(get('code_agence')),
      productCode: nullable(get('code_produit')),
      amount: amountRaw,
      currency,
      exchangeRate,
      comment: nullable(get('commentaire')),
      hypothesis: nullable(get('hypothese')),
    },
  };
}
