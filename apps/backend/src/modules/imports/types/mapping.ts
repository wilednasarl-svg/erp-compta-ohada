import type { DocumentType } from './import-status';

/**
 * Canonical target schema for an imported accounting line. Every parser
 * eventually projects the source row into this shape under
 * `import_staging_entries.mapped_values` (as `Partial<MappedRow>` with
 * every value stringified — JSON-safe representation, conversions to
 * Date / number happen at commit time in Module 3 wave 2).
 *
 *   account   — code OHADA (ex. "4111").
 *   journal   — code journal interne (ex. "VTE", "ACH").
 *   date      — date opération, normalisée en ISO `YYYY-MM-DD` côté
 *               mapping. La validation parse réellement la date.
 *   debit     — montant débit (string représentation décimale).
 *   credit    — montant crédit.
 *   label     — libellé écriture.
 *   partner   — tiers (client/fournisseur). Optionnel selon le journal.
 *   currency  — devise ISO 4217. Défaut implicite `XOF` (FCFA) côté
 *               service de validation si non fourni.
 */
export type TargetField =
  | 'account'
  | 'journal'
  | 'date'
  | 'debit'
  | 'credit'
  | 'label'
  | 'partner'
  | 'currency'
  | 'analyticAxisType'
  | 'analyticAxisCode'
  // Métadonnées de pièce comptable (modèle d'import journal Sage).
  // `pieceNumber` est la clé de regroupement des lignes en une écriture
  // au commit (et obligatoire pour `entries` — décision produit). Les
  // autres sont informatifs : mappés + persistés en staging mais non
  // propagés aux lignes d'écriture (pas de colonne dédiée côté ledger).
  | 'pieceNumber'
  | 'invoiceNumber'
  | 'reference'
  | 'taxCode'
  | 'dueDate';

export const TARGET_FIELDS: readonly TargetField[] = [
  'account',
  'journal',
  'date',
  'debit',
  'credit',
  'label',
  'partner',
  'currency',
  'analyticAxisType',
  'analyticAxisCode',
  'pieceNumber',
  'invoiceNumber',
  'reference',
  'taxCode',
  'dueDate',
] as const;

/**
 * Required target fields for an accounting line to be eligible for
 * commit. `partner` and `currency` restent optionnels au niveau
 * structurel — leurs règles métier sont gérées par `ValidationService`
 * (ex. partner obligatoire sur un journal de ventes).
 *
 * Conservé par rétrocompat — défaut du `documentType` historique
 * `'entries'`. La logique adaptive vit dans
 * `getRequiredFieldsForDocumentType`.
 */
export const REQUIRED_TARGET_FIELDS: readonly TargetField[] = [
  'account',
  'journal',
  'date',
  'label',
  'pieceNumber',
] as const;

/**
 * Champs requis par nature de document. Une `Balance` n'a ni date ni
 * journal par ligne (c'est un cumul à un instant T) ; un `Relevé
 * bancaire` n'a pas de compte (le compte est implicite — le compte
 * bancaire de l'organisation associé au fichier).
 *
 * Toute extension du `DocumentType` doit ajouter une entrée ici, sinon
 * `getRequiredFieldsForDocumentType` retombera sur le comportement
 * `entries` (défensif — pas un échec dur, mais loggable côté review).
 */
export const DOCUMENT_TYPE_REQUIRED_FIELDS: Readonly<Record<DocumentType, readonly TargetField[]>> =
  {
    // `pieceNumber` obligatoire sur les journaux d'écritures (décision
    // produit 2026-05-29) : c'est la clé de regroupement en pièce au
    // commit. Une balance / un grand livre / un relevé n'ont pas de
    // pièce par ligne — on ne l'exige donc que sur entries & ventes/achats.
    entries: ['account', 'journal', 'date', 'label', 'pieceNumber'],
    general_ledger: ['account', 'date', 'label'],
    trial_balance: ['account', 'label'],
    bank_statement: ['date', 'label'],
    auxiliary_ledger: ['account', 'partner', 'date', 'label'],
    sales_purchases: ['account', 'date', 'label', 'pieceNumber'],
  };

/**
 * Fonction pure exposant les champs requis pour un `DocumentType`
 * donné. Retombe sur `REQUIRED_TARGET_FIELDS` si la clé est inconnue
 * (futur ajout d'un type sans backfill du mapping).
 */
export function getRequiredFieldsForDocumentType(
  documentType: DocumentType,
): readonly TargetField[] {
  return DOCUMENT_TYPE_REQUIRED_FIELDS[documentType] ?? REQUIRED_TARGET_FIELDS;
}

/**
 * Mapped projection of a source row onto the canonical schema. All
 * values are kept as `string` (or `null` for missing) so the JSONB
 * column stays homogeneous and any numeric / date conversion is
 * performed once, at commit time, with auditable error handling.
 */
export type MappedRow = Partial<Record<TargetField, string | null>>;

/**
 * Mapping of source headers (normalised lowercase, accent-stripped) to
 * the canonical `TargetField`. Used by `MappingService.autoMap` to
 * propose a default header → target mapping that the user can override
 * before validation runs.
 *
 * The same synonym may legitimately appear in two cultures (`date` is
 * both FR and EN), so we centralise the dictionary instead of letting
 * each parser reinvent it.
 */
export const HEADER_SYNONYMS: Readonly<Record<TargetField, readonly string[]>> = {
  account: [
    'compte',
    'compte general',
    'numero compte',
    'no compte',
    // "N° compte" (symbole degré) se normalise en "n compte" — en-tête le
    // plus courant des exports Sage/grands livres, distinct de "no compte".
    'n compte',
    'account',
    'gl account',
    // Modèle d'import journal (export type Sage) : la colonne
    // "N° compte général" se normalise en "n compte general".
    'n compte general',
    'numero compte general',
    'no compte general',
    // FEC : colonne "CompteNum" → "comptenum" (le libellé "CompteLib"
    // n'est pas mappé — seul le numéro de compte nous intéresse).
    'comptenum',
    // EBP : "N° de compte" → "n de compte".
    'n de compte',
    'numero de compte',
    'no de compte',
  ],
  journal: [
    'journal',
    'code journal',
    'jrn',
    'journal code',
    'jo',
    'jal',
    'code jal',
    // FEC : colonne "JournalCode" → "journalcode" ("JournalLib" = libellé).
    'journalcode',
    // "C.J" (Code Journal abrégé, grands livres Sage) → "c j".
    'c j',
    'cj',
  ],
  date: [
    'date',
    'date ecriture',
    'date piece',
    'date operation',
    'posting date',
    // "Date saisie" / "Date de saisie" du modèle d'import journal.
    'date saisie',
    'date de saisie',
    'date comptable',
    // FEC : "EcritureDate" → "ecrituredate" (date de l'écriture).
    'ecrituredate',
    // EBP : "Date de pièce" → "date de piece" ("date piece" déjà couvert).
    'date de piece',
  ],
  // "Mt Débit" / "Mt Crédit" : abréviation des exports Ciel.
  debit: ['debit', 'montant debit', 'dr', 'debit amount', 'mt debit'],
  credit: ['credit', 'montant credit', 'cr', 'credit amount', 'mt credit'],
  label: [
    'libelle',
    'libelle ecriture',
    'description',
    'memo',
    'label',
    'narration',
    // FEC : "EcritureLib" → "ecriturelib" (libellé de l'écriture).
    'ecriturelib',
    // "Intitulé" / "Intitulé du compte" — en-tête standard des balances et
    // grands livres FR pour le nom du compte (sert de libellé de ligne).
    'intitule',
    'intitule du compte',
    'intitule compte',
  ],
  partner: [
    'tiers',
    'compte tiers',
    'partner',
    'client',
    'fournisseur',
    'code tiers',
    // "N° compte tiers" du modèle d'import journal → "n compte tiers".
    'n compte tiers',
    'numero compte tiers',
    'no compte tiers',
    // FEC : "CompAuxNum" → "compauxnum" (n° de compte auxiliaire = tiers).
    'compauxnum',
    // Odoo (FR) : colonne "Partenaire" sur l'export des écritures.
    'partenaire',
    // Sage / Ciel / EBP : "Compte auxiliaire" = compte tiers.
    'compte auxiliaire',
  ],
  currency: [
    'devise',
    'monnaie',
    'currency',
    'ccy',
    // FEC : "Idevise" → "idevise" (code ISO de la devise).
    'idevise',
  ],
  analyticAxisType: ['type axe', 'type analytique', 'axe type', 'axis type', 'nature analytique'],
  analyticAxisCode: [
    'chantier',
    'code chantier',
    'bu',
    'business unit',
    'projet',
    'code projet',
    'activite',
    'code activite',
    'section analytique',
    'axe',
    'code axe',
    'centre de cout',
    'cost center',
  ],
  // "N° pièce" du modèle d'import journal → "n piece". Clé de
  // regroupement en écriture au commit.
  pieceNumber: [
    'n piece',
    'numero piece',
    'no piece',
    'num piece',
    'piece',
    'no de piece',
    // FEC : "PieceRef" → "pieceref" (référence de la pièce justificative,
    // sert de clé de regroupement des lignes en une écriture au commit).
    'pieceref',
    // EBP : "N° de pièce" → "n de piece" ; "N° document" → "n document".
    'n de piece',
    'numero de piece',
    'n document',
    'numero document',
    'no document',
    // Odoo : la colonne "Numéro" (FR) / "Number" (EN) de l'export des
    // écritures porte le nom de la pièce (ex. "VTE/2026/0001") — c'est la
    // clé de regroupement naturelle. Sans risque de collision : les autres
    // numéros sont toujours qualifiés ("N° compte", "N° facture", …).
    'numero',
    'number',
  ],
  // "N° facture" → "n facture".
  invoiceNumber: [
    'n facture',
    'numero facture',
    'no facture',
    'num facture',
    'facture',
    'numero de facture',
  ],
  // "Référence" — référence libre de la ligne / pièce justificative.
  reference: ['reference', 'ref', 'reference externe', 'ref piece'],
  // "Code taxe" (entête tronquée "Code ta") — code TVA / taxe.
  taxCode: ['code taxe', 'code tva', 'code ta', 'taxe', 'tva'],
  // "Date échéance" → "date echeance".
  dueDate: ['date echeance', 'echeance', 'date d echeance', 'date de reglement', 'date limite'],
} as const;

/**
 * Result of the auto-mapping step. `headerToTarget` is sparse — headers
 * not recognised stay absent (the UI will let the user assign them
 * manually before validation runs). `unmappedTargets` lists the
 * canonical fields that no source header covered — purely informational
 * for the preview screen.
 */
export interface MappingProposal {
  headerToTarget: Record<string, TargetField>;
  unmappedTargets: readonly TargetField[];
}
