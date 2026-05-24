import { Injectable } from '@nestjs/common';

import {
  HEADER_SYNONYMS,
  type MappedRow,
  type MappingProposal,
  TARGET_FIELDS,
  type TargetField,
} from '../types/mapping';

/**
 * `MappingService` — projette les headers d'un fichier source sur le
 * schéma canonique d'une écriture comptable.
 *
 * Service pur (aucune dépendance), testable sans infra. Deux opérations :
 *
 *   - `autoMap(headers)` : propose un mapping `header → TargetField`
 *     basé sur le dictionnaire de synonymes (`HEADER_SYNONYMS`). Les
 *     headers non reconnus restent absents — la UI laissera l'utilisateur
 *     les assigner manuellement avant la validation.
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

    // Index synonyms once by normalised form for O(1) lookup.
    const synonymToTarget = new Map<string, TargetField>();
    for (const target of TARGET_FIELDS) {
      for (const synonym of HEADER_SYNONYMS[target]) {
        const normalised = normaliseHeader(synonym);
        if (!synonymToTarget.has(normalised)) {
          synonymToTarget.set(normalised, target);
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
