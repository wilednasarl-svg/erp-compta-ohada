import { Injectable } from '@nestjs/common';

import type {
  LlmProvider,
  LlmSemanticAnomalyInput,
  LlmSemanticAnomalyOutput,
  LlmSuggestAccountInput,
  LlmSuggestAccountOutput,
} from './llm-provider';

/**
 * Null-object provider — utilisé quand `ANTHROPIC_API_KEY` est absent
 * et dans les tests qui veulent forcer le chemin "fallback heuristique".
 *
 * Toutes les méthodes renvoient `null` ; les services métier interprètent
 * ce `null` comme "le LLM n'a pas d'opinion → bascule heuristique".
 */
@Injectable()
export class NullLlmProvider implements LlmProvider {
  public readonly id = 'null_v1';

  suggestAccount(_input: LlmSuggestAccountInput): Promise<LlmSuggestAccountOutput | null> {
    return Promise.resolve(null);
  }

  detectSemanticAnomaly(_input: LlmSemanticAnomalyInput): Promise<LlmSemanticAnomalyOutput | null> {
    return Promise.resolve(null);
  }
}
