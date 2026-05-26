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
  | 'currency';

export const TARGET_FIELDS: readonly TargetField[] = [
  'account',
  'journal',
  'date',
  'debit',
  'credit',
  'label',
  'partner',
  'currency',
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
export const DOCUMENT_TYPE_REQUIRED_FIELDS: Readonly<
  Record<DocumentType, readonly TargetField[]>
> = {
  entries: ['account', 'journal', 'date', 'label'],
  general_ledger: ['account', 'date', 'label'],
  trial_balance: ['account', 'label'],
  bank_statement: ['date', 'label'],
  auxiliary_ledger: ['account', 'partner', 'date', 'label'],
  sales_purchases: ['account', 'date', 'label'],
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
  account: ['compte', 'compte general', 'numero compte', 'no compte', 'account', 'gl account'],
  journal: ['journal', 'code journal', 'jrn', 'journal code'],
  date: ['date', 'date ecriture', 'date piece', 'date operation', 'posting date'],
  debit: ['debit', 'montant debit', 'dr', 'debit amount'],
  credit: ['credit', 'montant credit', 'cr', 'credit amount'],
  label: ['libelle', 'libelle ecriture', 'description', 'memo', 'label', 'narration'],
  partner: ['tiers', 'compte tiers', 'partner', 'client', 'fournisseur', 'code tiers'],
  currency: ['devise', 'monnaie', 'currency', 'ccy'],
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
