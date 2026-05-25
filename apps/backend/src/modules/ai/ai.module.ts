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
import { AiSuggestionService } from './services/ai-suggestion.service';

/**
 * AiModule — Module 11 wave 1 AI Engine.
 *
 * Heuristiques pures, ZÉRO appel ML/LLM. Le design garde la porte
 * ouverte à une wave 2 ML — on n'a qu'à ajouter un MLAnomalyService
 * derrière la même interface publique.
 *
 * AuthModule + RbacModule sont importés pour les guards locaux
 * (mémoire `nest-useguards-requires-module-imports`).
 *
 * On enregistre `AccountingPeriodEntity` localement parce que
 * JournalsModule n'exporte pas `AccountingPeriodRepository`.
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
  ],
  exports: [AiAnomalyService, AiSuggestionService],
})
export class AiModule {}
