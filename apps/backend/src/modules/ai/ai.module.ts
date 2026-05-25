import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPeriodEntity } from '../journals/entities/accounting-period.entity';
import { AccountingPeriodRepository } from '../journals/repositories/accounting-period.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { AiController } from './controllers/ai.controller';
import { AiAnomalyEntity } from './entities/ai-anomaly.entity';
import { AiAnomalyRepository } from './repositories/ai-anomaly.repository';
import { AiAnomalyService } from './services/ai-anomaly.service';
import { AiAssistantService } from './services/ai-assistant.service';
import { AiMappingService } from './services/ai-mapping.service';
import { AiSuggestionService } from './services/ai-suggestion.service';
import { AnthropicLlmProvider } from './services/anthropic-llm-provider';
import { ASSISTANT_PROVIDER } from './services/assistant-provider';
import { LLM_PROVIDER, type LlmProvider } from './services/llm-provider';
import { NullLlmProvider } from './services/null-llm-provider';
import { RuleBasedAssistantProvider } from './services/rule-based-assistant-provider';

/**
 * AiModule — Module 11.
 *
 * Wave 1 : anomalies + suggestions de compte (heuristiques pures).
 * Wave 2 : AI Mapping (auto-détection colonnes Sage) + AI Assistant
 *   (Q&A rule-based, interface prête pour LLM en wave 3).
 *
 * ZÉRO appel ML/LLM côté backend en wave 1+2. Le binding
 * `ASSISTANT_PROVIDER → RuleBasedAssistantProvider` se swap en wave 3
 * pour brancher un LLM sans toucher au controller ni au frontend.
 *
 * AuthModule + RbacModule sont importés pour les guards locaux
 * (mémoire `nest-useguards-requires-module-imports`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AiAnomalyEntity, AccountingPeriodEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [AiController],
  providers: [
    AiAnomalyRepository,
    AccountingPeriodRepository,
    AiAnomalyService,
    AiSuggestionService,
    AiMappingService,
    AiAssistantService,
    // Wave 2 default provider — bound to the abstract token. Swap this
    // class in wave 3 for a `LlmAssistantProvider`.
    RuleBasedAssistantProvider,
    { provide: ASSISTANT_PROVIDER, useExisting: RuleBasedAssistantProvider },
    // Wave 2 LLM provider — factory swap basée sur `ANTHROPIC_API_KEY`.
    // Si la clé est absente : `NullLlmProvider` (les services basculent
    // sur les heuristiques sans aucun appel réseau).
    {
      provide: LLM_PROVIDER,
      useFactory: (): LlmProvider => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey && apiKey.trim().length > 0) {
          return new AnthropicLlmProvider(apiKey);
        }
        return new NullLlmProvider();
      },
    },
  ],
  exports: [AiAnomalyService, AiSuggestionService, AiMappingService, AiAssistantService],
})
export class AiModule {}
