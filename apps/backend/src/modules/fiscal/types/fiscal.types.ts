/**
 * Types partagés du module Fiscal & Social. Les unions reflètent les CHECK
 * SQL de la migration 0113 — garder synchronisé.
 */

export type FiscalDeclarationKind = 'fiscal' | 'social';

/** Comment dériver la base imposable depuis la compta/budget. */
export type FiscalBaseKind =
  | 'turnover'
  | 'accounting_result'
  | 'salary_gross'
  | 'salary_capped'
  | 'vat_net'
  | 'custom';

export const FISCAL_BASE_KINDS: readonly FiscalBaseKind[] = [
  'turnover',
  'accounting_result',
  'salary_gross',
  'salary_capped',
  'vat_net',
  'custom',
];

export type FiscalPeriodicity = 'monthly' | 'quarterly' | 'annual';

export const FISCAL_PERIODICITIES: readonly FiscalPeriodicity[] = [
  'monthly',
  'quarterly',
  'annual',
];

/** Statut de dépôt d'une déclaration. */
export type FiscalDeclarationStatus = 'a_deposer' | 'depose' | 'paye' | 'annule';

export const FISCAL_DECLARATION_STATUSES: readonly FiscalDeclarationStatus[] = [
  'a_deposer',
  'depose',
  'paye',
  'annule',
];

/** Transitions de statut autorisées. */
export const FISCAL_STATUS_TRANSITIONS: Readonly<
  Record<FiscalDeclarationStatus, readonly FiscalDeclarationStatus[]>
> = {
  a_deposer: ['depose', 'annule'],
  depose: ['paye', 'a_deposer', 'annule'],
  paye: ['annule'],
  annule: [],
};

/**
 * Catalogue de paramètres CI par défaut (ordres de grandeur).
 *
 * ⚠️ À VALIDER par un conseil fiscal : l'Annexe fiscale (DGI) et le barème
 * CNPS sont révisés chaque année. Ces valeurs servent de point de départ
 * paramétrable, PAS de référence légale figée. `effectiveFrom` est posé au
 * 1er janvier de l'exercice courant lors du seed.
 *
 * Cas particuliers non couverts par un taux plat (à modéliser ultérieurement
 * via une table de barème dédiée) : ITS (barème progressif réforme 2024).
 */
export interface DefaultFiscalParameter {
  readonly taxCode: string;
  readonly label: string;
  readonly declarationKind: FiscalDeclarationKind;
  readonly rate: string;
  readonly baseKind: FiscalBaseKind;
  readonly periodicity: FiscalPeriodicity;
  readonly ceiling?: string | null;
  readonly dueDay?: number;
  readonly chargeAccount?: string | null;
  readonly liabilityAccount?: string | null;
  readonly notes?: string;
}

export const CI_DEFAULT_FISCAL_PARAMETERS: readonly DefaultFiscalParameter[] = [
  {
    taxCode: 'TVA',
    label: 'TVA (taux normal)',
    declarationKind: 'fiscal',
    rate: '18.0000',
    baseKind: 'vat_net',
    periodicity: 'monthly',
    dueDay: 15,
    chargeAccount: '4434',
    liabilityAccount: '4431',
    notes:
      'Taux normal 18%. Taux réduit 9% sur certains produits — paramétrer un second code si besoin.',
  },
  {
    taxCode: 'IS',
    label: 'Impôt sur les sociétés',
    declarationKind: 'fiscal',
    rate: '25.0000',
    baseKind: 'accounting_result',
    periodicity: 'annual',
    dueDay: 20,
    chargeAccount: '891',
    liabilityAccount: '441',
    notes: 'Taux général 25%. Acomptes en cours d’exercice + solde annuel. Comparer à l’IMF.',
  },
  {
    taxCode: 'IMF',
    label: 'Impôt minimum forfaitaire',
    declarationKind: 'fiscal',
    rate: '0.5000',
    baseKind: 'turnover',
    periodicity: 'annual',
    dueDay: 20,
    chargeAccount: '891',
    liabilityAccount: '441',
    notes: 'Plancher 0,5% du CA TTC, dû si supérieur à l’IS. Plancher/plafond légal à paramétrer.',
  },
  {
    taxCode: 'PATENTE',
    label: 'Contribution des patentes',
    declarationKind: 'fiscal',
    rate: '0.0000',
    baseKind: 'custom',
    periodicity: 'annual',
    dueDay: 15,
    chargeAccount: '6411',
    liabilityAccount: '4471',
    notes: 'Droit sur CA + droit sur valeur locative (barème) — base saisie manuellement.',
  },
  {
    taxCode: 'CNPS_RETRAITE_EMP',
    label: 'CNPS Retraite — part employeur',
    declarationKind: 'social',
    rate: '7.7000',
    baseKind: 'salary_capped',
    periodicity: 'monthly',
    ceiling: '3375000.00',
    dueDay: 15,
    chargeAccount: '6641',
    liabilityAccount: '4310',
    notes:
      'Plafond = 45× SMIG mensuel (à actualiser). Total retraite 14% (7,7 employeur / 6,3 salarié).',
  },
  {
    taxCode: 'CNPS_RETRAITE_SAL',
    label: 'CNPS Retraite — part salariale',
    declarationKind: 'social',
    rate: '6.3000',
    baseKind: 'salary_capped',
    periodicity: 'monthly',
    ceiling: '3375000.00',
    dueDay: 15,
    chargeAccount: '4220',
    liabilityAccount: '4310',
    notes: 'Retenue salariale. Plafond identique part employeur.',
  },
  {
    taxCode: 'CNPS_PF',
    label: 'CNPS Prestations familiales',
    declarationKind: 'social',
    rate: '5.7500',
    baseKind: 'salary_capped',
    periodicity: 'monthly',
    ceiling: '70000.00',
    dueDay: 15,
    chargeAccount: '6641',
    liabilityAccount: '4310',
    notes: 'Plafond mensuel ~70 000 FCFA. Part patronale.',
  },
  {
    taxCode: 'CNPS_AT',
    label: 'CNPS Accident du travail',
    declarationKind: 'social',
    rate: '2.0000',
    baseKind: 'salary_capped',
    periodicity: 'monthly',
    ceiling: '70000.00',
    dueDay: 15,
    chargeAccount: '6641',
    liabilityAccount: '4310',
    notes: 'Taux 2% à 5% selon le risque professionnel — ajuster.',
  },
  {
    taxCode: 'FDFP_TA',
    label: 'FDFP — Taxe d’apprentissage',
    declarationKind: 'social',
    rate: '0.4000',
    baseKind: 'salary_gross',
    periodicity: 'monthly',
    dueDay: 15,
    chargeAccount: '6413',
    liabilityAccount: '4470',
    notes: 'Assise sur la masse salariale brute.',
  },
  {
    taxCode: 'FDFP_FPC',
    label: 'FDFP — Formation professionnelle continue',
    declarationKind: 'social',
    rate: '0.6000',
    baseKind: 'salary_gross',
    periodicity: 'monthly',
    dueDay: 15,
    chargeAccount: '6413',
    liabilityAccount: '4470',
    notes: 'Assise sur la masse salariale brute.',
  },
  {
    taxCode: 'ITS',
    label: 'Impôt sur Traitements et Salaires (barème progressif)',
    declarationKind: 'social',
    rate: '0.0000',
    baseKind: 'custom',
    periodicity: 'monthly',
    dueDay: 15,
    chargeAccount: '4220',
    liabilityAccount: '4470',
    notes:
      'Réforme 2024 : barème PROGRESSIF (voir fiscal_tax_brackets). Base = salaire imposable PAR SALARIÉ — l’agrégat masse salariale donne un résultat approché (le progressif n’est pas additif). Saisir la base par tête ou via le futur module RH.',
  },
];

/** Une tranche de barème progressif par défaut. */
export interface DefaultTaxBracket {
  readonly bracketOrder: number;
  readonly fromAmount: string;
  readonly toAmount: string | null;
  readonly rate: string;
}

/**
 * Barème ITS CI mensuel par défaut (réforme 2024) — ⚠️ VALEURS
 * ILLUSTRATIVES À VALIDER impérativement contre le barème officiel DGI.
 * Le moteur de calcul est exact ; seuls les seuils/taux ci-dessous sont à
 * confirmer et sont éditables via l'endpoint de remplacement des tranches.
 */
export const CI_DEFAULT_ITS_BRACKETS: readonly DefaultTaxBracket[] = [
  { bracketOrder: 1, fromAmount: '0.00', toAmount: '75000.00', rate: '0.0000' },
  { bracketOrder: 2, fromAmount: '75000.00', toAmount: '240000.00', rate: '16.0000' },
  { bracketOrder: 3, fromAmount: '240000.00', toAmount: '800000.00', rate: '21.0000' },
  { bracketOrder: 4, fromAmount: '800000.00', toAmount: '2400000.00', rate: '24.0000' },
  { bracketOrder: 5, fromAmount: '2400000.00', toAmount: '8000000.00', rate: '28.0000' },
  { bracketOrder: 6, fromAmount: '8000000.00', toAmount: null, rate: '32.0000' },
];
