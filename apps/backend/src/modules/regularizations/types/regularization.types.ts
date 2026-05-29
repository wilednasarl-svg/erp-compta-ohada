/**
 * Module 22 (W3.5) — Régularisations périodiques OHADA.
 *
 * Référence : Tome 1 — Opérations courantes, chap. 6 « Régularisations
 * périodiques » (R41–R46).
 *
 * Quatre familles de régularisations de fin d'exercice :
 *
 *   - CCA (Charges Constatées d'Avance — compte 476) : la charge a été
 *     payée en N mais concerne (tout ou partie) N+1. On l'extourne de
 *     N pour la rattacher au bon exercice.
 *     Écriture N    : D 476 / C 6xx (HT)
 *     Contre-passe : D 6xx / C 476 (au 01/01 N+1)
 *
 *   - PCA (Produits Constatés d'Avance — compte 477) : symétrique des
 *     CCA pour les produits.
 *     Écriture N    : D 7xx / C 477
 *     Contre-passe : D 477 / C 7xx
 *
 *   - CAP (Charges à Payer — comptes 408, 4181, 4286, 4386, 4486…) :
 *     la consommation a eu lieu en N mais la facture n'est pas encore
 *     reçue. On enregistre la charge avec contrepartie en passif
 *     temporaire (et TVA récupérable miroir si applicable).
 *     Écriture N    : D 6xx + D 4455 / C 408 (TTC)
 *     Contre-passe : D 408 / C 6xx + C 4455
 *
 *   - PAR (Produits à Recevoir — comptes 4098, 4181, 4287, 4387, 449x) :
 *     produit acquis en N (RRR à obtenir, FAE…), facture à émettre.
 *     Écriture N    : D 4098 (ou 4181) / C 7xx + C 4435 (si TVA)
 *     Contre-passe : symétrique.
 *
 * Un batch regroupe plusieurs entrées (chaque entrée = une régul
 * individuelle). À l'exécution, le service génère UNE écriture
 * comptable qui agrège toutes les entrées dans le journal OD. La
 * contre-passation au 01/01 N+1 produit une seconde écriture
 * symétrique au `reversalDate` = `exerciseEndDate + 1 jour`.
 */

export type RegularizationType =
  | 'cca'
  | 'pca'
  | 'cap_charge'
  | 'cap_tva'
  | 'par_produit'
  | 'par_tva';

export type RegularizationBatchStatus = 'draft' | 'executed' | 'reversed' | 'cancelled';

/**
 * Description humaine de chaque type, utilisée notamment dans les
 * libellés d'écritures par défaut et dans le panneau d'aide UI (à
 * venir en follow-up).
 */
export const REGULARIZATION_TYPE_DESCRIPTION: Readonly<Record<RegularizationType, string>> = {
  cca: "Charges constatées d'avance",
  pca: "Produits constatés d'avance",
  cap_charge: 'Charges à payer (factures non parvenues)',
  cap_tva: 'TVA récupérable sur charges à payer',
  par_produit: 'Produits à recevoir (RRR ou FAE)',
  par_tva: 'TVA collectée sur factures à établir',
} as const;

/**
 * Décrit l'orientation D/C d'une entrée selon son type :
 *   - `expense_revenue_debit` : le compte 6xx/7xx est au DÉBIT
 *   - `expense_revenue_credit` : le compte 6xx/7xx est au CRÉDIT
 *
 * Cette table dérive directement des écritures cibles ci-dessus. Le
 * service consomme cette mappe pour construire les paires de lignes
 * sans coder en dur des `if/else` éparpillés.
 */
export interface RegularizationLineMapping {
  /** Côté du compte de charge/produit (6xx/7xx). */
  readonly expenseRevenueSide: 'debit' | 'credit';
  /** Côté du compte de régularisation (476/477/408/4181…). */
  readonly regularizationSide: 'debit' | 'credit';
}

export const REGULARIZATION_LINE_MAPPING: Readonly<
  Record<RegularizationType, RegularizationLineMapping>
> = {
  // D 476 / C 6xx  → expense=credit, regul=debit
  cca: { expenseRevenueSide: 'credit', regularizationSide: 'debit' },
  // D 7xx / C 477  → expense=debit, regul=credit
  pca: { expenseRevenueSide: 'debit', regularizationSide: 'credit' },
  // D 6xx / C 408  → expense=debit, regul=credit
  cap_charge: { expenseRevenueSide: 'debit', regularizationSide: 'credit' },
  // D 4455 / C 408 (TVA miroir : "expense" porte la TVA récupérable 4455)
  cap_tva: { expenseRevenueSide: 'debit', regularizationSide: 'credit' },
  // D 4098 / C 7xx  → expense=credit, regul=debit
  par_produit: { expenseRevenueSide: 'credit', regularizationSide: 'debit' },
  // D 4181 / C 4435 (TVA miroir : "regul" porte 4435 TVA collectée)
  par_tva: { expenseRevenueSide: 'debit', regularizationSide: 'credit' },
} as const;

export const ALL_REGULARIZATION_TYPES: ReadonlyArray<RegularizationType> = Object.keys(
  REGULARIZATION_TYPE_DESCRIPTION,
) as ReadonlyArray<RegularizationType>;

export function isRegularizationType(value: unknown): value is RegularizationType {
  return (
    typeof value === 'string' && (ALL_REGULARIZATION_TYPES as ReadonlyArray<string>).includes(value)
  );
}
