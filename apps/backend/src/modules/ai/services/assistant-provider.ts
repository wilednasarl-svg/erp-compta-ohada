import type { TenantId } from '../../../common/persistence/tenant-scope';

/**
 * `AssistantProvider` — interface stable que `AiAssistantService`
 * consomme. Wave 2 livre un seul implémentation : `RuleBasedAssistantProvider`
 * (déterministe, sans LLM). Wave 3 pourra plugger un provider LLM
 * (Anthropic, OpenAI, local) derrière la même surface — le controller
 * et le frontend ne changent pas.
 *
 * Le retour est volontairement structuré : un `answer` lisible en
 * français + des `supportingData` typés pour permettre à l'UI
 * d'afficher des tableaux/graphiques si la question s'y prête.
 */

export interface AssistantContext {
  readonly organizationId: TenantId;
  /** Période courante par défaut — utilisée par les questions du type
   *  "anomalies de la période". Optionnelle si la question ne dépend
   *  pas d'un exercice particulier. */
  readonly periodId?: string;
}

export interface AssistantAnswer {
  /** Réponse en français, prête à être rendue tel quel. */
  readonly answer: string;
  /** Confiance 0-100 — wave 2 rule-based n'excède pas 80 (la limite
   *  monte avec un LLM en wave 3). */
  readonly confidence: number;
  /** Le pattern qui a matché côté provider. `null` si non reconnu. */
  readonly matchedIntent: string | null;
  /** Données structurées exploitables côté UI (graphes, tables).
   *  Schema libre : chaque intent documente le sien. */
  readonly supportingData?: Record<string, unknown>;
}

export interface AssistantProvider {
  /** Identifiant + version du provider — sérialisé dans l'audit. */
  readonly id: string;

  ask(question: string, context: AssistantContext): Promise<AssistantAnswer>;
}

/**
 * Injection token. Le module bind ce token sur `RuleBasedAssistantProvider`
 * en wave 2 ; wave 3 pourra swap pour un `LlmAssistantProvider` sans
 * changer le service ni le controller.
 */
export const ASSISTANT_PROVIDER = Symbol('ASSISTANT_PROVIDER');
