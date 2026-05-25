import { Injectable, Logger } from '@nestjs/common';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';

/**
 * Module 11 wave 2 — AI Mapping pour fichiers Sage.
 *
 * Reconnaissance automatique des colonnes d'un export Sage (ou tout
 * autre CSV comptable) vers les champs canoniques du Module 3 Imports.
 * Aucun appel ML/LLM : on combine deux signaux déterministes —
 *
 *  - Pattern-matching sur le NOM de l'en-tête (variantes Sage 100,
 *    Sage Ligne 100, Sage Compta i7, exports français + diacritiques)
 *  - Inférence de TYPE depuis un échantillon de valeurs (date, numeric,
 *    account code regex SYSCOHADA)
 *
 * Le mapping retourné est explicable : chaque suggestion porte sa
 * `confidence` et sa `reason` en français pour qu'un comptable puisse
 * valider d'un coup d'œil en page d'import.
 */

/** Champs cibles du Module 3 Imports — miroir de l'auto-mapper actuel. */
export type TargetField =
  | 'account_code'
  | 'description'
  | 'debit'
  | 'credit'
  | 'entry_date'
  | 'journal_code'
  | 'partner'
  | 'reference';

export const TARGET_FIELDS: ReadonlyArray<TargetField> = [
  'account_code',
  'description',
  'debit',
  'credit',
  'entry_date',
  'journal_code',
  'partner',
  'reference',
];

export interface ColumnMapping {
  readonly sourceColumn: string;
  readonly sourceIndex: number;
  readonly targetField: TargetField | null;
  readonly confidence: number; // 0-100
  readonly reason: string;
}

export interface MappingSuggestionInput {
  readonly organizationId: TenantId;
  readonly headers: ReadonlyArray<string>;
  /** N premières lignes pour l'inférence par valeurs. Optionnel. */
  readonly sampleRows?: ReadonlyArray<ReadonlyArray<string>>;
}

/** Synonymes acceptés par champ. Accent-insensitive, lowercased côté
 *  matching. Ordonnés du plus spécifique au plus générique pour que
 *  la première correspondance trouvée gagne. */
const HEADER_PATTERNS: Readonly<Record<TargetField, ReadonlyArray<string>>> = {
  account_code: [
    'n° compte',
    'numero de compte',
    'numero compte',
    'no compte',
    'code compte',
    'cpt',
    'compte general',
    'compte',
  ],
  description: ['libelle ecriture', 'libelle', 'description', 'objet', 'designation'],
  debit: ['montant debit', 'debit'],
  credit: ['montant credit', 'credit'],
  entry_date: [
    "date d'ecriture",
    'date ecriture',
    'date operation',
    'date piece',
    'date comptable',
    'date',
  ],
  journal_code: ['code journal', 'journal', 'jrn'],
  partner: ['compte tiers', 'tiers', 'client', 'fournisseur', 'partner'],
  reference: [
    'n° piece',
    'numero piece',
    'no piece',
    'piece',
    'reference piece',
    'reference',
    'ref',
  ],
};

@Injectable()
export class AiMappingService {
  private static readonly MODULE = 'ai' as const;
  private readonly logger = new Logger(AiMappingService.name);

  constructor(private readonly audit: AuditTrailService) {}

  async suggestColumns(
    input: MappingSuggestionInput,
    actorId: string,
    ctx: AuditContext,
  ): Promise<{ mappings: ColumnMapping[]; coverage: number }> {
    assertTenantId(input.organizationId);

    const mappings: ColumnMapping[] = input.headers.map((header, idx) =>
      this.inferColumn(header, idx, input.sampleRows ?? []),
    );

    // Empêche deux colonnes de matcher le même target avec une
    // confidence égale — on garde celle au score le plus haut, l'autre
    // tombe à `null`. Tiebreak : index ascendant.
    const winners = new Map<TargetField, number>();
    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      if (m.targetField === null) continue;
      const cur = winners.get(m.targetField);
      if (cur === undefined || m.confidence > mappings[cur].confidence) {
        winners.set(m.targetField, i);
      }
    }
    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      if (m.targetField === null) continue;
      if (winners.get(m.targetField) !== i) {
        mappings[i] = {
          ...m,
          targetField: null,
          confidence: 0,
          reason: `${m.reason} (écarté : ${m.targetField} déjà mappé par une colonne plus probable).`,
        };
      }
    }

    const mappedTargets = new Set(mappings.map((m) => m.targetField).filter((t) => t !== null));
    const coverage = Math.round((mappedTargets.size / TARGET_FIELDS.length) * 100);

    await this.audit
      .record({
        module: AiMappingService.MODULE,
        action: 'mapping_suggested',
        entityType: 'import_session',
        entityId: 'preview',
        after: { headerCount: input.headers.length, coverage, mappedFields: [...mappedTargets] },
        ctx: { ...ctx, userId: actorId, organizationId: input.organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));

    return { mappings, coverage };
  }

  // ─── Heuristiques publiques (testables) ──────────────────────────────

  /**
   * Inférence d'une colonne. Combine pattern-matching sur le header
   * (signal fort, confiance 70-90) avec l'inférence par valeurs
   * (signal d'appui, +10 à +20 quand cohérent, -20 quand contradictoire).
   */
  inferColumn(
    header: string,
    sourceIndex: number,
    sampleRows: ReadonlyArray<ReadonlyArray<string>>,
  ): ColumnMapping {
    const normalised = this.normalise(header);
    const patternMatch = this.matchHeaderPattern(normalised);
    const sampleValues = sampleRows.map((row) => row[sourceIndex] ?? '').filter((v) => v !== '');
    const valueInference = this.inferFromValues(sampleValues);

    // Pattern + valeurs cohérentes → confiance maximale
    if (
      patternMatch &&
      valueInference &&
      this.isCompatible(patternMatch.field, valueInference.kind)
    ) {
      const confidence = Math.min(95, patternMatch.confidence + 15);
      return {
        sourceColumn: header,
        sourceIndex,
        targetField: patternMatch.field,
        confidence,
        reason: `En-tête "${header}" → ${patternMatch.field}; valeurs cohérentes (${valueInference.kind}).`,
      };
    }

    // Pattern seul → confiance moyenne
    if (patternMatch) {
      return {
        sourceColumn: header,
        sourceIndex,
        targetField: patternMatch.field,
        confidence: patternMatch.confidence,
        reason: `En-tête "${header}" matche pattern Sage "${patternMatch.matched}".`,
      };
    }

    // Valeurs seules → inférence faible, confiance plafonnée à 55
    if (valueInference) {
      return {
        sourceColumn: header,
        sourceIndex,
        targetField: valueInference.field,
        confidence: valueInference.confidence,
        reason: `En-tête "${header}" non reconnu, valeurs détectées : ${valueInference.kind} → ${valueInference.field}.`,
      };
    }

    return {
      sourceColumn: header,
      sourceIndex,
      targetField: null,
      confidence: 0,
      reason: `En-tête "${header}" non reconnu, valeurs non discriminantes.`,
    };
  }

  /** Match exact (après normalisation) puis match par préfixe. */
  matchHeaderPattern(normalised: string): {
    field: TargetField;
    matched: string;
    confidence: number;
  } | null {
    for (const field of TARGET_FIELDS) {
      const patterns = HEADER_PATTERNS[field];
      for (const p of patterns) {
        if (normalised === p) {
          return { field, matched: p, confidence: 85 };
        }
      }
    }
    // Préfixe : "Compte général" matche "compte"
    for (const field of TARGET_FIELDS) {
      const patterns = HEADER_PATTERNS[field];
      for (const p of patterns) {
        if (normalised.startsWith(p) || normalised.includes(p)) {
          return { field, matched: p, confidence: 70 };
        }
      }
    }
    return null;
  }

  /**
   * Détermine le type dominant de l'échantillon. Renvoie le `field`
   * cible le plus probable + sa confidence (≤ 55 sans signal d'en-tête).
   */
  inferFromValues(values: ReadonlyArray<string>): {
    field: TargetField;
    kind: 'date' | 'numeric' | 'account_code' | 'text';
    confidence: number;
  } | null {
    if (values.length === 0) return null;
    const counters = { date: 0, numeric: 0, account_code: 0, text: 0 };
    for (const v of values) {
      const trimmed = v.trim();
      if (this.looksLikeDate(trimmed)) counters.date++;
      else if (this.looksLikeAccountCode(trimmed)) counters.account_code++;
      else if (this.looksLikeNumeric(trimmed)) counters.numeric++;
      else counters.text++;
    }
    const total = values.length;
    const sorted = (Object.entries(counters) as Array<[keyof typeof counters, number]>).sort(
      (a, b) => b[1] - a[1],
    );
    const [topKind, topCount] = sorted[0];
    const share = topCount / total;
    if (share < 0.6) return null;
    const confidence = Math.min(55, Math.round(share * 60));
    if (topKind === 'date') return { field: 'entry_date', kind: 'date', confidence };
    if (topKind === 'account_code')
      return { field: 'account_code', kind: 'account_code', confidence };
    if (topKind === 'numeric') return { field: 'debit', kind: 'numeric', confidence: 40 }; // debit/credit ambiguë → reste sous le pattern-match
    return null;
  }

  // ─── Internes ────────────────────────────────────────────────────────

  private isCompatible(
    field: TargetField,
    kind: 'date' | 'numeric' | 'account_code' | 'text',
  ): boolean {
    switch (field) {
      case 'entry_date':
        return kind === 'date';
      case 'debit':
      case 'credit':
        return kind === 'numeric';
      case 'account_code':
        return kind === 'account_code' || kind === 'numeric';
      default:
        return kind === 'text' || kind === 'numeric'; // libellé, tiers, journal → tolérant
    }
  }

  private normalise(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private looksLikeDate(v: string): boolean {
    // YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (formats Sage FR usuels)
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(v) ||
      /^\d{2}\/\d{2}\/\d{4}$/.test(v) ||
      /^\d{2}-\d{2}-\d{4}$/.test(v) ||
      /^\d{2}\.\d{2}\.\d{4}$/.test(v)
    );
  }

  private looksLikeAccountCode(v: string): boolean {
    // SYSCOHADA : 1 à 10 chiffres commençant par 1-9
    return /^[1-9]\d{0,9}$/.test(v);
  }

  private looksLikeNumeric(v: string): boolean {
    // Tolère espaces (séparateur de milliers FR) + virgule décimale
    const cleaned = v.replace(/\s/g, '').replace(',', '.');
    if (cleaned === '') return false;
    return /^-?\d+(\.\d+)?$/.test(cleaned);
  }
}
