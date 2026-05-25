import { Injectable } from '@nestjs/common';

import type { DocumentType } from '../types/import-status';
import {
  HEADER_SYNONYMS,
  type MappedRow,
  type MappingProposal,
  TARGET_FIELDS,
  type TargetField,
} from '../types/mapping';
import { parseImportDate } from './validation.service';

/**
 * Synonymes additionnels par type de document. Étendent (sans
 * remplacer) le dictionnaire global `HEADER_SYNONYMS`. Utile pour les
 * variations d'export Sage / Excel propres à chaque nature de document.
 *
 * Ex. dans un Grand Livre, "mouvement débit" et "mouvement crédit"
 * désignent débit/crédit ; dans une Balance, "solde débit" / "solde
 * crédit" mappent vers les mêmes targets.
 */
const DOCUMENT_TYPE_SYNONYMS: Readonly<
  Record<DocumentType, Partial<Record<TargetField, readonly string[]>>>
> = {
  entries: {},
  general_ledger: {
    debit: ['mouvement debit', 'mvt debit', 'debit periode'],
    credit: ['mouvement credit', 'mvt credit', 'credit periode'],
  },
  trial_balance: {
    debit: ['solde debiteur', 'sd', 'solde debit', 'total debit'],
    credit: ['solde crediteur', 'sc', 'solde credit', 'total credit'],
  },
  bank_statement: {
    label: ['operation', 'libelle operation', 'description operation', 'motif'],
    debit: ['debit montant', 'sortie', 'depense', 'montant debite'],
    credit: ['credit montant', 'entree', 'recette', 'montant credite'],
  },
  auxiliary_ledger: {
    partner: ['compte tiers', 'code tiers', 'reference tiers', 'cpte aux'],
    account: ['compte general', 'cpte general', 'compte collectif'],
  },
  sales_purchases: {
    partner: ['client', 'fournisseur', 'compte client', 'compte fournisseur'],
  },
};

/**
 * `MappingService` — projette les headers d'un fichier source sur le
 * schéma canonique d'une écriture comptable.
 *
 * Service pur (aucune dépendance), testable sans infra. Deux opérations :
 *
 *   - `autoMap(headers, overrides, sampleRows)` : propose un mapping
 *     `header → TargetField` via deux passes :
 *       1. dictionnaire de synonymes (`HEADER_SYNONYMS`) — rapide,
 *          déterministe, basé uniquement sur le nom de la colonne ;
 *       2. détection par contenu — si un `sampleRows` est fourni, les
 *          colonnes encore non mappées sont inférées en regardant le
 *          contenu réel (dates Excel série, codes SYSCOHADA, montants,
 *          codes journal, codes tiers). Seuil 70 % d'accord requis.
 *     Les overrides utilisateur l'emportent toujours sur l'auto-détection.
 *   - `applyMapping(raw, mapping)` : matérialise un `MappedRow` à partir
 *     des valeurs brutes du parser et d'un mapping (potentiellement
 *     issu d'`autoMap` + overrides utilisateur).
 *
 * Conventions :
 *   - normalisation des headers : trim → lowercase → strip accents →
 *     compact whitespace. Garantit que "Compte Général", "compte
 *     général", "COMPTE  GENERAL" matchent tous "compte general".
 *   - première rencontre gagne : si deux headers normalisent à la même
 *     valeur, le premier conserve sa place.
 *   - chaque `TargetField` ne peut être mappé qu'à UN header source à
 *     la fois — sinon `applyMapping` lèverait deux valeurs concurrentes
 *     sans règle de tie-break.
 */
@Injectable()
export class MappingService {
  autoMap(
    headers: readonly string[],
    overrides: Record<string, TargetField> = {},
    sampleRows: ReadonlyArray<Record<string, string | null>> = [],
    documentType: DocumentType | null = null,
  ): MappingProposal {
    const headerToTarget: Record<string, TargetField> = {};
    const usedTargets = new Set<TargetField>();

    // Apply manual overrides first — they win over synonyms
    for (const header of headers) {
      const overrideTarget = overrides[header];
      if (overrideTarget !== undefined) {
        headerToTarget[header] = overrideTarget;
        usedTargets.add(overrideTarget);
      }
    }

    // Index synonyms once by normalised form for O(1) lookup. Le
    // documentType ajoute des synonymes spécifiques au type de fichier
    // (ex. "mouvement debit" → debit pour un Grand Livre).
    const synonymToTarget = new Map<string, TargetField>();
    for (const target of TARGET_FIELDS) {
      for (const synonym of HEADER_SYNONYMS[target]) {
        const normalised = normaliseHeader(synonym);
        if (!synonymToTarget.has(normalised)) {
          synonymToTarget.set(normalised, target);
        }
      }
    }
    if (documentType !== null) {
      const extra = DOCUMENT_TYPE_SYNONYMS[documentType];
      for (const target of TARGET_FIELDS) {
        const synonyms = extra[target];
        if (synonyms === undefined) continue;
        for (const synonym of synonyms) {
          const normalised = normaliseHeader(synonym);
          if (!synonymToTarget.has(normalised)) {
            synonymToTarget.set(normalised, target);
          }
        }
      }
    }

    for (const header of headers) {
      // Skip if this header was already mapped via an override
      if (headerToTarget[header] !== undefined) {
        continue;
      }

      const normalised = normaliseHeader(header);
      if (normalised.length === 0) {
        continue;
      }
      const target = synonymToTarget.get(normalised);
      if (target === undefined) {
        continue;
      }
      if (usedTargets.has(target)) {
        // Another header already claimed this target (via override or first match)
        continue;
      }
      headerToTarget[header] = target;
      usedTargets.add(target);
    }

    // ─── Content-based fallback ─────────────────────────────────────
    // Pour chaque header encore non mappé, on regarde le contenu réel
    // des cellules (échantillon de lignes du fichier). Permet de
    // récupérer les cas où le header est peu standard (ex. "DT OP",
    // "GL CODE", "PCE No") mais où les valeurs sont sans ambiguïté.
    if (sampleRows.length > 0) {
      for (const header of headers) {
        if (headerToTarget[header] !== undefined) continue;
        const samples = collectColumnSamples(sampleRows, header);
        if (samples.length < 3) continue;
        const inferred = inferTargetFromSamples(samples, usedTargets);
        if (inferred !== null) {
          headerToTarget[header] = inferred;
          usedTargets.add(inferred);
        }
      }
    }

    const unmappedTargets = TARGET_FIELDS.filter((t) => !usedTargets.has(t));
    return { headerToTarget, unmappedTargets };
  }

  applyMapping(
    raw: Readonly<Record<string, string | null>>,
    mapping: Readonly<Record<string, TargetField>>,
  ): MappedRow {
    const out: MappedRow = {};
    for (const [header, target] of Object.entries(mapping)) {
      const value = raw[header];
      // Normalisation au moment du mapping : on convertit les dates
      // détectables (Excel serial, DD/MM/YYYY, etc.) en ISO YYYY-MM-DD
      // dès cette étape. Bénéfices :
      //   - la preview affiche des dates lisibles (pas "45658"),
      //   - les analytics agrègent correctement par jour,
      //   - le commit reçoit des dates déjà normalisées.
      if (target === 'date' && typeof value === 'string' && value.trim().length > 0) {
        const parsed = parseImportDate(value);
        if (parsed !== null) {
          out[target] = toIsoDate(parsed);
          continue;
        }
      }
      out[target] = value === undefined ? null : value;
    }
    return out;
  }
}

/**
 * Normalise un header source pour matcher les synonymes :
 *   - trim
 *   - lowercase
 *   - retire les accents (NFD + drop diacritics)
 *   - écrase les espaces multiples en un seul
 *   - retire les caractères de ponctuation (`.`, `:`, `(`, `)`)
 *
 * Exemples :
 *   "  Compte Général  "  → "compte general"
 *   "Date d'écriture"     → "date d ecriture"  (' devient espace)
 *   "Débit (€)"           → "debit"
 */
function normaliseHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Content-based detection helpers ─────────────────────────────────

const CONTENT_MATCH_THRESHOLD = 0.7; // 70% des cellules doivent matcher

function collectColumnSamples(
  rows: ReadonlyArray<Record<string, string | null>>,
  header: string,
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const v = row[header];
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
    if (out.length >= 50) break; // cap à 50 valeurs — assez pour décider
  }
  return out;
}

/**
 * Infère le `TargetField` d'une colonne à partir d'un échantillon de
 * valeurs. Stratégie : compter combien de cellules ressemblent à
 * chaque type, puis sélectionner le type qui dépasse le seuil et
 * dont le `TargetField` n'est pas déjà pris.
 *
 * Ordre de priorité quand plusieurs candidats matchent (rare car les
 * tests sont relativement exclusifs) :
 *   1. date (signal le plus fiable)
 *   2. account (codes SYSCOHADA, signal fort)
 *   3. journal (codes alphabétiques courts)
 *   4. partner (codes mixtes alphanumériques)
 *   5. amount (debit ou credit — peut être ambigu, donc bas)
 */
function inferTargetFromSamples(
  samples: ReadonlyArray<string>,
  usedTargets: ReadonlySet<TargetField>,
): TargetField | null {
  const total = samples.length;
  const ratio = (count: number) => count / total;

  const dateMatches = samples.filter(looksLikeDate).length;
  if (!usedTargets.has('date') && ratio(dateMatches) >= CONTENT_MATCH_THRESHOLD) {
    return 'date';
  }

  const accountMatches = samples.filter(looksLikeAccountCode).length;
  if (!usedTargets.has('account') && ratio(accountMatches) >= CONTENT_MATCH_THRESHOLD) {
    return 'account';
  }

  const journalMatches = samples.filter(looksLikeJournalCode).length;
  if (!usedTargets.has('journal') && ratio(journalMatches) >= CONTENT_MATCH_THRESHOLD) {
    return 'journal';
  }

  const partnerMatches = samples.filter(looksLikePartnerCode).length;
  if (!usedTargets.has('partner') && ratio(partnerMatches) >= CONTENT_MATCH_THRESHOLD) {
    return 'partner';
  }

  // Amount detection (debit OR credit). On ne peut pas distinguer les
  // deux par le contenu seul — on choisit "debit" en premier, "credit"
  // en second si une autre colonne ressemble aussi à un montant.
  const amountMatches = samples.filter(looksLikeAmount).length;
  if (ratio(amountMatches) >= CONTENT_MATCH_THRESHOLD) {
    if (!usedTargets.has('debit')) return 'debit';
    if (!usedTargets.has('credit')) return 'credit';
  }

  return null;
}

function looksLikeDate(v: string): boolean {
  return parseImportDate(v) !== null;
}

/**
 * Code de compte SYSCOHADA-like : 3 à 10 chiffres, commence par 1-9.
 * Tolère un préfixe textuel court (ex. "411-CL") en ne regardant que
 * la partie numérique initiale.
 */
function looksLikeAccountCode(v: string): boolean {
  return /^[1-9]\d{2,9}$/.test(v);
}

function looksLikeJournalCode(v: string): boolean {
  // 2 à 6 caractères, majoritairement alphabétiques (autorise 1 chiffre
  // pour les variantes "BQE1", "BQE2"). On exclut tout ce qui contient
  // des espaces ou de la ponctuation.
  return /^[A-Za-z]{2,6}\d?$/.test(v);
}

function looksLikePartnerCode(v: string): boolean {
  // Codes auxiliaires : commencent souvent par une lettre (C, F, T)
  // suivie de chiffres, longueur 3-15.
  return /^[A-Za-z][A-Za-z0-9_-]{2,14}$/.test(v) && !looksLikeJournalCode(v);
}

function looksLikeAmount(v: string): boolean {
  // Nombre avec ou sans séparateurs FR/EN, autorise signe négatif.
  // Doit avoir au moins un chiffre. Exclut les valeurs trop courtes
  // pour être plausibles (un chiffre seul peut être un ID).
  const cleaned = v.replace(/[\s ]/g, '').replace(/,/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return false;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return false;
  // Heuristique : un montant comptable typique a |valeur| >= 10 ou
  // une partie décimale. Filtre les "0", "1", "2"… qui sont plus
  // probablement des flags / IDs.
  return Math.abs(n) >= 10 || cleaned.includes('.');
}
