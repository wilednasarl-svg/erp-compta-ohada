import { Injectable, Logger } from '@nestjs/common';

import type {
  LlmProvider,
  LlmSemanticAnomalyInput,
  LlmSemanticAnomalyOutput,
  LlmSuggestAccountInput,
  LlmSuggestAccountOutput,
} from './llm-provider';

/**
 * Anthropic Claude provider — Module 11 wave 2.
 *
 * Appelle directement l'API REST Anthropic via `fetch` natif (Node 20+),
 * sans SDK. Sur erreur (timeout 5s, status ≥ 500, JSON invalide, body
 * inattendu), renvoie `null` : les services métier basculent sur les
 * heuristiques wave 1.
 *
 * Le modèle (`claude-haiku-4-5-20251001`) est choisi pour le rapport
 * latence/coût ; les prompts sont volontairement courts (max 256 tokens
 * en sortie) et ancrés sur SYSCOHADA OHADA pour limiter les
 * hallucinations.
 *
 * Limitations connues :
 *  - Pas de streaming (la suggestion est synchrone, 5s max)
 *  - Pas de retry — un échec = fallback heuristique immédiat
 *  - Pas de cache : chaque appel touche l'API
 */
@Injectable()
export class AnthropicLlmProvider implements LlmProvider {
  public readonly id = 'anthropic_claude_haiku_4_5_v1';
  private readonly logger = new Logger(AnthropicLlmProvider.name);

  private static readonly ENDPOINT = 'https://api.anthropic.com/v1/messages';
  private static readonly MODEL = 'claude-haiku-4-5-20251001';
  private static readonly MAX_TOKENS = 256;
  private static readonly TIMEOUT_MS = 5000;
  private static readonly ANTHROPIC_VERSION = '2023-06-01';

  private static readonly SYSTEM_PROMPT =
    'Tu es un assistant comptable expert du référentiel SYSCOHADA (OHADA, ' +
    "Côte d'Ivoire). Tu réponds UNIQUEMENT en JSON valide, sans markdown, " +
    'sans commentaire, sans texte avant ou après. Les codes de compte sont ' +
    'à 3-6 chiffres conformément au plan SYSCOHADA AUDCIF (classes 1-9).';

  constructor(private readonly apiKey: string) {}

  async suggestAccount(input: LlmSuggestAccountInput): Promise<LlmSuggestAccountOutput | null> {
    const historicalLines = input.historicalSamples
      .slice(0, 8)
      .map(
        (s, i) =>
          `${i + 1}. libellé="${s.description}" → compte ${s.accountCode}` +
          (s.partner ? ` (tiers: ${s.partner})` : ''),
      )
      .join('\n');

    const userPrompt =
      `Suggère le compte SYSCOHADA le plus adapté pour cette écriture.\n\n` +
      `Libellé : "${input.description}"\n` +
      `Tiers : ${input.partner ?? '(aucun)'}\n` +
      `Côté : ${input.side ?? '(non précisé)'}\n\n` +
      `Historique d'écritures similaires :\n${historicalLines || '(aucun)'}\n\n` +
      `Réponds UNIQUEMENT par ce JSON :\n` +
      `{"accountCode":"<code SYSCOHADA>","confidence":<nombre 0..1>,"reasoning":"<phrase courte en français>"}`;

    const raw = await this.callClaude(userPrompt);
    if (raw === null) return null;

    const parsed = this.safeParseSuggestion(raw);
    if (!parsed) {
      this.logger.warn(
        `Anthropic suggestAccount: JSON invalide → fallback. Body=${raw.slice(0, 200)}`,
      );
      return null;
    }
    return parsed;
  }

  async detectSemanticAnomaly(
    input: LlmSemanticAnomalyInput,
  ): Promise<LlmSemanticAnomalyOutput | null> {
    const userPrompt =
      `Évalue si la combinaison libellé/compte est sémantiquement cohérente ` +
      `selon le plan SYSCOHADA.\n\n` +
      `Libellé : "${input.description}"\n` +
      `Compte : ${input.accountCode}\n` +
      `Tiers : ${input.partner ?? '(aucun)'}\n` +
      `Montant : ${input.amount}\n\n` +
      `Exemple d'anomalie : libellé "Salaire" sur un compte de classe 60 (achats).\n\n` +
      `Réponds UNIQUEMENT par ce JSON :\n` +
      `{"isAnomaly":<true|false>,"confidence":<nombre 0..1>,"reasoning":"<phrase courte en français>"}`;

    const raw = await this.callClaude(userPrompt);
    if (raw === null) return null;

    const parsed = this.safeParseAnomaly(raw);
    if (!parsed) {
      this.logger.warn(
        `Anthropic detectSemanticAnomaly: JSON invalide → fallback. Body=${raw.slice(0, 200)}`,
      );
      return null;
    }
    return parsed;
  }

  private async callClaude(userPrompt: string): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AnthropicLlmProvider.TIMEOUT_MS);

    try {
      const res = await fetch(AnthropicLlmProvider.ENDPOINT, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': AnthropicLlmProvider.ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: AnthropicLlmProvider.MODEL,
          max_tokens: AnthropicLlmProvider.MAX_TOKENS,
          system: AnthropicLlmProvider.SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!res.ok) {
        this.logger.warn(`Anthropic call failed: status=${res.status}`);
        return null;
      }

      const json = await res.json();
      return this.extractText(json);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Anthropic call exception: ${msg}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractText(json: unknown): string | null {
    if (json === null || typeof json !== 'object') return null;
    const obj = json as { content?: unknown };
    if (!Array.isArray(obj.content)) return null;
    const first = obj.content[0] as { type?: unknown; text?: unknown } | undefined;
    if (!first || first.type !== 'text' || typeof first.text !== 'string') return null;
    return first.text;
  }

  private safeParseSuggestion(text: string): LlmSuggestAccountOutput | null {
    const trimmed = this.stripCodeFences(text).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object') return null;
    const obj = parsed as {
      accountCode?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    };
    if (typeof obj.accountCode !== 'string' || obj.accountCode.length === 0) return null;
    if (typeof obj.confidence !== 'number' || !Number.isFinite(obj.confidence)) return null;
    if (typeof obj.reasoning !== 'string') return null;
    const confidence = Math.max(0, Math.min(1, obj.confidence));
    return {
      accountCode: obj.accountCode.trim(),
      confidence,
      reasoning: obj.reasoning.trim(),
    };
  }

  private safeParseAnomaly(text: string): LlmSemanticAnomalyOutput | null {
    const trimmed = this.stripCodeFences(text).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object') return null;
    const obj = parsed as {
      isAnomaly?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    };
    if (typeof obj.isAnomaly !== 'boolean') return null;
    if (typeof obj.confidence !== 'number' || !Number.isFinite(obj.confidence)) return null;
    if (typeof obj.reasoning !== 'string') return null;
    const confidence = Math.max(0, Math.min(1, obj.confidence));
    return {
      isAnomaly: obj.isAnomaly,
      confidence,
      reasoning: obj.reasoning.trim(),
    };
  }

  private stripCodeFences(text: string): string {
    // Claude peut entourer le JSON avec ```json … ``` malgré l'instruction.
    return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
}
