import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';

/**
 * Module 11 wave 1 — Suggestions de compte heuristiques.
 *
 * Pattern-matching mots-clés OHADA + historique majoritaire 12 mois.
 * Aucun appel ML/LLM. Le design garde la porte ouverte à wave 2.
 */

export interface SuggestionInput {
  readonly organizationId: TenantId;
  readonly description: string | null;
  readonly partner?: string | null;
  readonly side?: 'debit' | 'credit';
}

export interface AccountSuggestion {
  readonly suggestedAccountCode: string;
  readonly confidence: number;
  readonly reasons: string[];
  readonly alternative?: {
    readonly accountCode: string;
    readonly confidence: number;
    readonly reasons: string[];
  };
}

const KEYWORD_PATTERNS: ReadonlyArray<{
  readonly keywords: ReadonlyArray<string>;
  readonly accountCode: string;
  readonly label: string;
  readonly side: 'debit' | 'credit' | 'both';
}> = [
  {
    keywords: ['loyer', 'location bureau', 'location immobiliere'],
    accountCode: '6132',
    label: 'Locations immobilières',
    side: 'debit',
  },
  {
    keywords: ['salaire', 'paie', 'remuneration', 'bulletin'],
    accountCode: '661',
    label: 'Rémunérations du personnel',
    side: 'debit',
  },
  {
    keywords: ['electricite', 'cie', 'eau', 'sodeci'],
    accountCode: '6051',
    label: 'Fournitures non stockables — eau/électricité',
    side: 'debit',
  },
  {
    keywords: ['telephone', 'orange ci', 'mtn', 'moov', 'internet', 'abonnement telecom'],
    accountCode: '6281',
    label: 'Frais de télécommunication',
    side: 'debit',
  },
  {
    keywords: ['carburant', 'essence', 'gasoil', 'station service'],
    accountCode: '6052',
    label: 'Carburants et lubrifiants',
    side: 'debit',
  },
  {
    keywords: ['honoraire', 'consultant', 'avocat', 'expert comptable'],
    accountCode: '6324',
    label: 'Honoraires',
    side: 'debit',
  },
  {
    keywords: ['achat marchandise', 'facture fournisseur'],
    accountCode: '601',
    label: 'Achats de marchandises',
    side: 'debit',
  },
  {
    keywords: ['vente', 'facture client', 'prestation client'],
    accountCode: '701',
    label: 'Ventes',
    side: 'credit',
  },
  {
    keywords: ['virement', 'cheque', 'depot banque', 'retrait banque'],
    accountCode: '521',
    label: 'Banques locales',
    side: 'both',
  },
  { keywords: ['caisse', 'especes', 'cash'], accountCode: '571', label: 'Caisse', side: 'both' },
  {
    keywords: ['patente', 'taxe communale', 'impot foncier'],
    accountCode: '6461',
    label: 'Taxes communales',
    side: 'debit',
  },
];

@Injectable()
export class AiSuggestionService {
  private static readonly MODULE = 'ai' as const;
  private readonly logger = new Logger(AiSuggestionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditTrailService,
  ) {}

  async suggestAccountForEntry(
    input: SuggestionInput,
    actorId: string,
    ctx: AuditContext,
  ): Promise<AccountSuggestion | null> {
    assertTenantId(input.organizationId);
    const normalised = this.normalise(input.description ?? '');
    if (normalised.length === 0 && !input.partner) {
      await this.emitAudit(
        'suggestion_requested',
        'no-op',
        { reason: 'empty-input' },
        ctx,
        actorId,
        input.organizationId,
      );
      return null;
    }

    const [patternMatch, historyMatch] = await Promise.all([
      Promise.resolve(this.matchKeywordPattern(normalised, input.side)),
      this.matchHistory(input.organizationId, normalised, input.partner ?? null),
    ]);

    const suggestion = this.combine(patternMatch, historyMatch);

    await this.emitAudit(
      'suggestion_requested',
      'entry',
      {
        descriptionLength: input.description?.length ?? 0,
        partner: input.partner ?? null,
        suggested: suggestion?.suggestedAccountCode ?? null,
        confidence: suggestion?.confidence ?? 0,
      },
      ctx,
      actorId,
      input.organizationId,
    );

    return suggestion;
  }

  matchKeywordPattern(
    descriptionNormalised: string,
    side: 'debit' | 'credit' | undefined,
  ): { accountCode: string; confidence: number; reason: string } | null {
    if (descriptionNormalised.length === 0) return null;
    for (const pattern of KEYWORD_PATTERNS) {
      if (side && pattern.side !== 'both' && pattern.side !== side) continue;
      for (const kw of pattern.keywords) {
        if (descriptionNormalised.includes(kw)) {
          return {
            accountCode: pattern.accountCode,
            confidence: 50,
            reason: `Mot-clé "${kw}" → ${pattern.accountCode} (${pattern.label}).`,
          };
        }
      }
    }
    return null;
  }

  async matchHistory(
    organizationId: TenantId,
    descriptionNormalised: string,
    partner: string | null,
  ): Promise<{ accountCode: string; confidence: number; reason: string; total: number } | null> {
    const tokens = descriptionNormalised.split(/\s+/).filter((t) => t.length >= 4);
    if (tokens.length === 0 && !partner) return null;
    const likePatterns = tokens.map((t) => `%${t}%`);
    const rows = await this.dataSource.query<Array<{ account_code: string; n: string }>>(
      `SELECT a.code AS account_code, COUNT(*)::text AS n
       FROM journal_entry_lines l
       JOIN journal_entries e             ON e.id = l.journal_entry_id
       JOIN organization_chart_accounts a ON a.id = l.account_id
       WHERE l.organization_id = $1
         AND e.status = 'validated'
         AND e.entry_date >= (CURRENT_DATE - INTERVAL '12 months')
         AND (
           ($2::text[] = ARRAY[]::text[])
           OR LOWER(l.description) ILIKE ANY ($2::text[])
         )
       GROUP BY a.code
       ORDER BY COUNT(*) DESC
       LIMIT 5`,
      [organizationId, likePatterns],
    );
    if (rows.length === 0) return null;
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    if (total === 0) return null;
    const top = rows[0];
    const share = Number(top.n) / total;
    const confidence = Math.min(95, Math.round(share * 100));
    if (confidence < 25) return null;
    return {
      accountCode: top.account_code,
      confidence,
      reason: `Historique 12 mois : ${top.n}/${total} écritures sur libellé similaire → ${top.account_code}.`,
      total,
    };
  }

  private combine(
    pattern: { accountCode: string; confidence: number; reason: string } | null,
    history: { accountCode: string; confidence: number; reason: string; total: number } | null,
  ): AccountSuggestion | null {
    if (!pattern && !history) return null;
    if (pattern && history && pattern.accountCode === history.accountCode) {
      return {
        suggestedAccountCode: pattern.accountCode,
        confidence: Math.min(95, pattern.confidence + history.confidence / 2),
        reasons: [pattern.reason, history.reason],
      };
    }
    if (pattern && history) {
      const [top, alt] =
        pattern.confidence >= history.confidence ? [pattern, history] : [history, pattern];
      return {
        suggestedAccountCode: top.accountCode,
        confidence: top.confidence,
        reasons: [top.reason],
        alternative: {
          accountCode: alt.accountCode,
          confidence: alt.confidence,
          reasons: [alt.reason],
        },
      };
    }
    const only = (pattern ?? history)!;
    return {
      suggestedAccountCode: only.accountCode,
      confidence: only.confidence,
      reasons: [only.reason],
    };
  }

  private normalise(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim();
  }

  private async emitAudit(
    action: string,
    entityId: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
    actorId: string,
    organizationId: TenantId | string,
  ): Promise<void> {
    await this.audit
      .record({
        module: AiSuggestionService.MODULE,
        action,
        entityType: 'journal_entry',
        entityId,
        after: data,
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }
}
