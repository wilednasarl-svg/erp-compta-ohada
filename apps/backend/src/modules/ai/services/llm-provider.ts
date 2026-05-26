/**
 * Module 11 wave 2 — LLM provider interface.
 *
 * Surface stable consommée par `AiSuggestionService` et
 * `AiAnomalyService`. Permet de plugger un provider Anthropic Claude
 * (wave 2), OpenAI ou un modèle local (wave 3+) sans toucher aux
 * services métier.
 *
 * Convention : un provider qui n'a pas d'opinion (clé API absente,
 * timeout, erreur 5xx, JSON invalide, confiance trop basse) renvoie
 * `null`. Les services basculent silencieusement sur les heuristiques
 * wave 1 — le LLM est *augmentation*, pas dépendance dure.
 */

export interface LlmHistoricalSample {
  readonly description: string;
  readonly accountCode: string;
  readonly partner: string | null;
}

export interface LlmSuggestAccountInput {
  readonly description: string;
  readonly partner: string | null;
  readonly side: 'debit' | 'credit' | undefined;
  readonly historicalSamples: ReadonlyArray<LlmHistoricalSample>;
}

export interface LlmSuggestAccountOutput {
  readonly accountCode: string;
  /** Confiance normalisée 0..1 (le service métier rejette si < 0.6). */
  readonly confidence: number;
  /** Justification en français, prête à être rendue à l'utilisateur. */
  readonly reasoning: string;
}

export interface LlmSemanticAnomalyInput {
  readonly description: string;
  readonly accountCode: string;
  readonly partner: string | null;
  readonly amount: number;
}

export interface LlmSemanticAnomalyOutput {
  readonly isAnomaly: boolean;
  /** Confiance normalisée 0..1. */
  readonly confidence: number;
  /** Justification en français. Doit citer le compte et le libellé. */
  readonly reasoning: string;
}

export interface LlmProvider {
  /** Identifiant + version du provider — sérialisé dans l'audit. */
  readonly id: string;

  /**
   * Suggère un compte SYSCOHADA pour une écriture.
   * Renvoie `null` si le provider n'a pas d'opinion (no key, timeout,
   * erreur réseau, parse error). Les services basculent alors sur
   * l'heuristique wave 1.
   */
  suggestAccount(input: LlmSuggestAccountInput): Promise<LlmSuggestAccountOutput | null>;

  /**
   * Détecte si la combinaison description/compte est sémantiquement
   * cohérente (ex. : compte 60x avec libellé "Salaire" est suspect).
   * Renvoie `null` en cas d'erreur — pas d'anomalie levée.
   */
  detectSemanticAnomaly(input: LlmSemanticAnomalyInput): Promise<LlmSemanticAnomalyOutput | null>;
}

/**
 * Injection token. Bind sur `AnthropicLlmProvider` si
 * `ANTHROPIC_API_KEY` est défini, sinon sur `NullLlmProvider`.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
