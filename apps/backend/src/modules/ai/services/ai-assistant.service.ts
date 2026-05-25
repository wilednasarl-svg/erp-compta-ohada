import { Inject, Injectable, Logger } from '@nestjs/common';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import {
  ASSISTANT_PROVIDER,
  type AssistantAnswer,
  type AssistantProvider,
} from './assistant-provider';

export interface AskAssistantInput {
  readonly organizationId: TenantId;
  readonly question: string;
  readonly periodId?: string;
}

/**
 * `AiAssistantService` — orchestrateur. Délègue la réponse à un
 * provider injecté via le token `ASSISTANT_PROVIDER`. Wave 2 utilise
 * `RuleBasedAssistantProvider` ; wave 3 swap le binding pour un
 * provider LLM sans toucher au controller.
 *
 * Journalise chaque question dans l'audit (module `ai`, action
 * `assistant_ask`) avec : question, intent matched, confidence,
 * provider id. Permet de mesurer le taux de reconnaissance.
 */
@Injectable()
export class AiAssistantService {
  private static readonly MODULE = 'ai' as const;
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    @Inject(ASSISTANT_PROVIDER) private readonly provider: AssistantProvider,
    private readonly audit: AuditTrailService,
  ) {}

  async ask(
    input: AskAssistantInput,
    actorId: string,
    ctx: AuditContext,
  ): Promise<AssistantAnswer> {
    assertTenantId(input.organizationId);

    const answer = await this.provider.ask(input.question, {
      organizationId: input.organizationId,
      periodId: input.periodId,
    });

    await this.audit
      .record({
        module: AiAssistantService.MODULE,
        action: 'assistant_ask',
        entityType: 'assistant_question',
        entityId: this.provider.id,
        after: {
          question: input.question.slice(0, 500),
          providerId: this.provider.id,
          matchedIntent: answer.matchedIntent,
          confidence: answer.confidence,
        },
        ctx: { ...ctx, userId: actorId, organizationId: input.organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));

    return answer;
  }
}
