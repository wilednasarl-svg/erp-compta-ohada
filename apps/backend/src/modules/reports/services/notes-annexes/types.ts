/**
 * Module 9 — W2.4 : Moteur des Notes annexes SYSCOHADA.
 *
 * Doctrine (Tome 3, "Les Notes annexes ne sont pas un appendice, mais un
 * état financier à part entière, ayant la même importance que les trois
 * autres"). 36 notes obligatoires N1..N36 (avec sous-notes A/B/C/D/E).
 *
 * Architecture :
 *   - `NoteId`   : identifiant canonique d'une note (ex: 'N1', 'N3A')
 *   - `NoteContent` : structure rendue par un handler (lignes + commentaire)
 *   - `NoteHandler` : signature d'un handler ; chacun calcule UNE note
 *   - `NotesAnnexesService` : orchestrateur ; injecte le bon handler
 *
 * Les montants sont retournés en `string` pour préserver la précision
 * DECIMAL(15,2). Pas de conversion `number` côté API.
 */

import type { TenantId } from '../../../../common/persistence/tenant-scope';
import type { CashFlowReport } from '../cash-flow.service';

/**
 * Identifiant d'une note annexe SYSCOHADA. Format : 'N' suivi du numéro
 * (1..36), avec optionnellement un suffixe A/B/C/D/E pour les sous-notes.
 */
export type NoteId =
  | `N${number}`
  | `N${number}A`
  | `N${number}B`
  | `N${number}C`
  | `N${number}D`
  | `N${number}E`;

/** Section de la liasse à laquelle la note se rattache. */
export type NoteSection = 'IDENTIFICATION' | 'BILAN' | 'CR' | 'TFT' | 'GENERAL';

/**
 * Métadonnées statiques d'une note. Vivent dans le registry et ne
 * dépendent ni du tenant ni de l'exercice.
 */
export interface NoteMetadata {
  readonly id: NoteId;
  readonly label: string;
  readonly section: NoteSection;
  /**
   * Si `true`, la note est par défaut considérée comme applicable à toute
   * organisation. Si `false`, le comptable doit explicitement la marquer
   * applicable (ex: notes spécifiques à un secteur).
   */
  readonly applicableByDefault: boolean;
}

/**
 * Une ligne d'une note. `values` est un dictionnaire libre : chaque
 * handler définit ses propres colonnes (ex: { brut, amort, vnc } pour
 * une immobilisation, { soldeOuverture, mouvements, soldeCloture } pour
 * une provision).
 *
 * Tous les montants sont des strings DECIMAL(15,2) — la sérialisation
 * JSON les passe tels quels.
 */
export interface NoteRow {
  readonly key: string;
  readonly label: string;
  readonly values: Readonly<Record<string, string>>;
}

/**
 * Résultat rendu d'une note pour un exercice donné.
 *
 *   - `applicable` : `false` ⇒ la note est marquée "N/A" dans la liasse
 *     et les `rows` sont vides. Persistance via `note_annexe_comments`.
 *   - `freeComment` : texte libre saisi par le comptable, persisté.
 *   - `computedAt` : ISO timestamp côté serveur (pas de cache).
 */
export interface NoteContent {
  readonly id: NoteId;
  readonly metadata: NoteMetadata;
  readonly applicable: boolean;
  readonly rows: ReadonlyArray<NoteRow>;
  readonly freeComment?: string;
  readonly computedAt: string;
}

/**
 * Contexte passé à chaque handler. Contient l'identité du tenant +
 * l'exercice de référence (period_start/period_end). Les handlers
 * délèguent aux repositories pour lire les données.
 */
export interface NoteComputationContext {
  readonly organizationId: TenantId | string;
  readonly exerciseId: string;
  readonly periodStart: string; // YYYY-MM-DD
  readonly periodEnd: string; // YYYY-MM-DD
  /** Année fiscale (utile pour Asset/DepreciationSchedule). */
  readonly fiscalYear: number;
}

/** Signature d'un handler de note. */
export type NoteHandler = (
  ctx: NoteComputationContext,
  deps: NoteHandlerDependencies,
) => Promise<{
  readonly rows: ReadonlyArray<NoteRow>;
  readonly applicable: boolean;
}>;

/**
 * Dépendances injectées à chaque handler. On passe les repositories tels
 * quels — pas d'abstraction supplémentaire ; le handler choisit ce qu'il
 * utilise.
 *
 * Volontairement typé large (`unknown`) pour éviter l'import circulaire
 * avec les modules `assets/`, `inventory/`, `accounting-plan/`. Le
 * service les caste en interne.
 */
export interface NoteHandlerDependencies {
  readonly reports: NoteReportsDeps;
  readonly assets: NoteAssetsDeps;
  readonly inventory: NoteInventoryDeps;
  readonly accounts: NoteAccountsDeps;
  readonly cashFlow: NoteCashFlowDeps;
}

/** Sous-interfaces — minimales, écrites côté consommateur. */
export interface NoteReportsDeps {
  readonly accountBalancesAsAt: (
    organizationId: TenantId | string,
    asAtDate: string,
  ) => Promise<
    ReadonlyArray<{
      accountId: string;
      accountCode: string;
      accountLabel: string;
      accountClass: number;
      isOpposing: boolean;
      totalDebit: string;
      totalCredit: string;
    }>
  >;
}

export interface NoteAssetsDeps {
  readonly findAllForExercise: (
    organizationId: TenantId | string,
    fiscalYear: number,
  ) => Promise<ReadonlyArray<NoteAssetRecord>>;
  readonly findDepreciationForYear: (
    organizationId: TenantId | string,
    fiscalYear: number,
  ) => Promise<ReadonlyArray<NoteDepreciationRecord>>;
}

export interface NoteInventoryDeps {
  readonly findAllItems: (
    organizationId: TenantId | string,
  ) => Promise<ReadonlyArray<NoteInventoryItem>>;
}

export interface NoteAccountsDeps {
  readonly findById: (
    organizationId: TenantId | string,
    accountId: string,
  ) => Promise<{ id: string; code: string; label: string; class: number } | null>;
}

/**
 * Sous-dépendance dédiée à N31 (TFT ventilé). Le handler N31 consomme
 * uniquement le rendu du Tableau des Flux de Trésorerie produit par
 * `CashFlowService.getCashFlow`. On expose une fonction au signature
 * réduite (sans `CashFlowQuery`) pour découpler les handlers du shape
 * exact du service.
 */
export interface NoteCashFlowDeps {
  readonly getCashFlow: (
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
    previousFromDate?: string,
    previousToDate?: string,
  ) => Promise<CashFlowReport>;
}

/**
 * Vue minimale d'un Asset utilisée par les handlers (N3A/N3C/N3D).
 * Découplage volontaire du `AssetEntity` complet.
 */
export interface NoteAssetRecord {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly acquisitionDate: string;
  readonly acquisitionCost: string;
  readonly assetAccountCode: string;
  readonly status: 'active' | 'fully_depreciated' | 'disposed';
  readonly disposalDate: string | null;
  readonly disposalValue: string | null;
}

/** Vue minimale d'une ligne `depreciation_schedules`. */
export interface NoteDepreciationRecord {
  readonly assetId: string;
  readonly fiscalYear: number;
  readonly depreciationAmount: string;
  readonly cumulativeDepreciation: string;
  readonly netBookValue: string;
}

/** Vue minimale d'un `inventory_items` row. */
export interface NoteInventoryItem {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly family:
    | 'marchandises'
    | 'matieres'
    | 'fournitures'
    | 'en_cours'
    | 'produits_finis'
    | 'en_route';
  readonly currentQty: string;
  readonly currentCmp: string;
}

/**
 * Erreur typée jetée par les handlers stub. Permet au service de
 * distinguer "note pas encore implémentée" de "erreur réelle" lors du
 * `getAllNotes`.
 */
export class NotImplementedError extends Error {
  constructor(noteId: NoteId, roadmap: string) {
    super(`Note ${noteId} pending — see roadmap ${roadmap}`);
    this.name = 'NotImplementedError';
  }
}

/** Mapping famille de stock → racine de compte SYSCOHADA. */
export const STOCK_FAMILY_TO_ACCOUNT_ROOT: Readonly<Record<NoteInventoryItem['family'], string>> = {
  marchandises: '31',
  matieres: '32',
  fournitures: '33',
  en_cours: '34',
  produits_finis: '36',
  en_route: '37',
};

/** Libellés humains des familles de stock pour la note N6. */
export const STOCK_FAMILY_LABELS: Readonly<Record<NoteInventoryItem['family'], string>> = {
  marchandises: 'Marchandises (31)',
  matieres: 'Matières premières (32)',
  fournitures: 'Autres approvisionnements (33)',
  en_cours: 'Produits en cours (34/35)',
  produits_finis: 'Produits finis (36)',
  en_route: 'Stocks en cours de route (37)',
};
