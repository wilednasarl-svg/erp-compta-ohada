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
import type { ActuarialCommitmentSnapshot } from '../../../actuarial-commitments/types/actuarial-commitment.types';
import type { CashFlowReport } from '../cash-flow.service';

/**
 * Identifiant d'une note annexe SYSCOHADA. Format : 'N' suivi du numéro
 * (1..36), avec optionnellement un suffixe A/B/C/D/E/F ou la variante
 * 'Bbis' (NOTE 16B bis de la doctrine Tome 3).
 *
 * Le type littéral permet aux template strings de couvrir N1..N99, et
 * les variantes explicites 'Bbis' / 'F' couvrent le cas hors-grille.
 */
export type NoteId =
  | `N${number}`
  | `N${number}A`
  | `N${number}B`
  | `N${number}Bbis`
  | `N${number}C`
  | `N${number}D`
  | `N${number}E`
  | `N${number}F`;

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
  /**
   * Dépendance C3 — données issues du profile DSF (R2).
   * Alimente notamment la Note 27B (effectifs par qualification).
   * Optionnelle pour rester rétro-compatible avec les tests historiques ;
   * les handlers qui en dépendent vérifient sa présence avant usage.
   */
  readonly dsfProfile?: NoteDsfProfileDeps;
  /**
   * Dépendance C3 — indicateurs de synthèse pré-calculés (bilan + SIG
   * + flux de trésorerie) consommés par la Note 34. Optionnelle pour
   * rester rétro-compatible avec les tests historiques ; le handler
   * retourne une ligne « source indisponible » si la dépendance n'est
   * pas câblée (cas notamment du registry spec qui mock un dataset vide).
   */
  readonly synthesisIndicators?: NoteSynthesisIndicatorsDeps;
  /**
   * Dépendance E2 — données issues du module
   * `actuarial-commitments` (Tome 3 N16B + Tome 2 chap. 21). Alimente
   * la Note 16B (engagements de retraite & avantages au personnel).
   * Optionnelle pour rester rétro-compatible avec les tests historiques :
   * si absente, le handler N16B retombe sur la balance compte 196 seule
   * + freeComment.
   */
  readonly actuarialCommitments?: NoteActuarialCommitmentsDeps;
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
  /**
   * Mouvements bornés [fromDate, toDate] — pour les notes de GESTION
   * (classes 6/7/8) qui doivent refléter l'exercice, pas le cumul depuis
   * l'origine (sinon divergence avec le Compte de résultat).
   */
  readonly accountMovementsBetween: (
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
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
 * Sous-dépendance C3 — lit le profile DSF (R2) du tenant. Aujourd'hui
 * la seule donnée consommée est le Record `workforceByQualification`
 * (codes YA-YO masse salariale, Tome 3 p. 30) utilisé par la Note 27B.
 *
 * Le contrat est volontairement minimal pour éviter d'importer
 * `OrganizationDsfProfileEntity` dans le moteur de notes (séparation
 * pure de concerns + pas de cycle DI).
 */
export interface NoteDsfProfileDeps {
  readonly getWorkforceByQualification: (
    organizationId: TenantId | string,
  ) => Promise<Readonly<Record<string, number>>>;
}

/**
 * Bundle d'indicateurs de synthèse alimentant la Note 34. Les montants
 * sont passés en string DECIMAL pour respecter la précision et le
 * contrat de retour des autres handlers ; les ratios sont passés en
 * number (sans unité monétaire). Les valeurs indisponibles
 * (ex. ratios à dénominateur nul) sont `null`.
 */
export interface NoteSynthesisSnapshot {
  // ── Section 1 — Analyse de l'activité (cascade SIG XA → XI) ─────────
  readonly chiffreAffaires: string; // SIG XB
  /** Marge commerciale — SIG XA. */
  readonly margeCommerciale: string;
  readonly valeurAjoutee: string; // SIG XC
  readonly excedentBrutExploitation: string; // SIG XD
  readonly resultatExploitation: string; // SIG XE
  /** Résultat financier — SIG XF. */
  readonly resultatFinancier: string;
  /** Résultat des activités ordinaires (RAO) — SIG XG. */
  readonly resultatAO: string;
  /** Résultat hors activités ordinaires (RHAO) — SIG XH. */
  readonly resultatHAO: string;
  readonly resultatNet: string; // SIG XI

  // ── Section 2 — Détermination de la CAFG (additive) ────────────────
  /** = EBE (SIG XD). Point de départ « CAFG d'exploitation ». */
  readonly cafgExploitation: string;
  /** + Revenus financiers encaissables — SIG TK + TL + TM. */
  readonly revenusFinanciers: string;
  /** + Produits HAO encaissables — SIG TO. */
  readonly produitsHAO: string;
  /** − Frais financiers — SIG RM. */
  readonly fraisFinanciers: string;
  /** − Impôts sur les résultats — SIG RS. */
  readonly impotsResultat: string;
  /**
   * = Capacité d'autofinancement globale.
   * = EBE + revenus fin. + produits HAO − frais fin. − impôts.
   */
  readonly cafg: string;
  /**
   * − Distributions de dividendes opérées dans l'exercice.
   * NON DISPONIBLE proprement (pas de source dédiée sur les dividendes
   * versés) ⇒ documenté à 0.00. Voir mapping getSnapshot.
   */
  readonly dividendes: string;
  /** = Autofinancement = CAFG − dividendes. */
  readonly autofinancement: string;

  // ── Section 4 — Analyse de la structure financière ─────────────────
  /** Actif immobilisé — masse bilan AZ. */
  readonly actifImmobilise: string;
  /** Actif circulant d'exploitation — masse BK − poste BA (circ. HAO). */
  readonly actifCircExploitation: string;
  /** Passif circulant d'exploitation — masse DP − poste DH (circ. HAO). */
  readonly passifCircExploitation: string;
  /** Actif circulant HAO — poste bilan BA (485/488). */
  readonly actifCircHAO: string;
  /** Passif circulant HAO — poste bilan DH (481/482/484). */
  readonly passifCircHAO: string;
  /** (1) Fonds de roulement = ressources stables − actif immobilisé. */
  readonly fondsRoulement: string;
  /** (2) Besoin de financement d'exploitation = ACE − PCE. */
  readonly besoinFinExploitation: string;
  /** (3) Besoin de financement HAO = ACHAO − PCHAO. */
  readonly besoinFinHAO: string;
  /** (4) Besoin de financement global = (2) + (3). */
  readonly besoinFinGlobal: string;
  /** (5) Trésorerie nette = (1) − (4). */
  readonly tresorerieNette: string;

  // ── Section 5 — Variation de la trésorerie (TFT) ───────────────────
  /** Flux des activités opérationnelles — TFT ZB. */
  readonly fluxOperationnels: string;
  /** Flux d'investissement — TFT ZC. */
  readonly fluxInvestissement: string;
  /** Flux de financement — TFT ZF. */
  readonly fluxFinancement: string;

  // ── Données de bilan partagées (sections 3, 4 et 6) ────────────────
  readonly totalActif: string;
  readonly totalCapitauxPropres: string;
  readonly dettesFinancieres: string;
  readonly actifCirculant: string;
  readonly tresorerieActif: string;
  readonly passifCirculant: string;
  readonly tresoreriePassif: string;
  readonly variationTresorerie: string;
}

/**
 * Sous-dépendance C3 — agrégateur d'indicateurs pour la Note 34
 * (Fiche de synthèse). Le service met à disposition une fonction qui
 * exécute en parallèle `getBalanceSheet`, `getSig` et `getCashFlow`
 * et renvoie un snapshot normalisé.
 */
export interface NoteSynthesisIndicatorsDeps {
  readonly getSnapshot: (
    organizationId: TenantId | string,
    periodStart: string,
    periodEnd: string,
  ) => Promise<NoteSynthesisSnapshot>;
}

/**
 * Sous-dépendance E2 — lit les évaluations actuarielles actives du
 * tenant. Consommée par le handler Note 16B pour combiner la partie
 * provisionnée (compte 196) avec la partie hors-bilan.
 *
 * Contrat minimal : on n'expose que la lecture des snapshots stables —
 * le module `actuarial-commitments` est responsable de la conversion
 * entité → snapshot.
 */
export interface NoteActuarialCommitmentsDeps {
  readonly listActiveByOrg: (
    organizationId: TenantId | string,
  ) => Promise<ReadonlyArray<ActuarialCommitmentSnapshot>>;
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
