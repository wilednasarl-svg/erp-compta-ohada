import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { TransformationsModule } from '../transformations/transformations.module';
import { ImportStagingEntryEntity } from '../imports/entities/import-staging-entry.entity';
import { ImportSessionEntity } from '../imports/entities/import-session.entity';
import { RulesController } from './controllers/rules.controller';
import { RuleExecutionEntity } from './entities/rule-execution.entity';
import { RuleEntity } from './entities/rule.entity';
import { RuleExecutionRepository } from './repositories/rule-execution.repository';
import { RuleRepository } from './repositories/rule.repository';
import { RuleEngineService } from './services/rule-engine.service';
import { RulesService } from './services/rules.service';

/**
 * `RulesModule` — Module 5 Rule Engine (wave 1).
 *
 * Compose :
 *   - entités `RuleEntity` + `RuleExecutionEntity` + leurs repos,
 *   - `ImportStagingEntryEntity` + `ImportSessionEntity` (read-only pour
 *     le fetch des écritures dans RuleEngineService),
 *   - `RulesService` (CRUD règles),
 *   - `RuleEngineService` (evaluate / simulate / apply),
 *   - `RulesController` (7 endpoints REST).
 *
 * Imports :
 *   - `TransformationsModule` — exporte `TransformationService` consommé
 *     par `RuleEngineService.applyRules`.
 *   - `AuditModule` — exporte `AuditTrailService`.
 *   - `AuthModule` / `RbacModule` — guards (@UseGuards sur le controller).
 *
 * Note DI (cf. mémoire nest-useguards-requires-module-imports) :
 *   AuthModule et RbacModule doivent être importés ICI (pas seulement en APP_GUARD
 *   global) sinon NestJS ne trouve pas JwtAuthGuard/TenantGuard dans le contexte
 *   DI local et crash au boot.
 *
 * Les entités d'import sont montées directement via `TypeOrmModule.forFeature`
 * plutôt qu'en important `ImportsModule` (qui apporterait ses parsers et services
 * inutiles ici, et risquerait des circulaires).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RuleEntity,
      RuleExecutionEntity,
      ImportStagingEntryEntity,
      ImportSessionEntity,
    ]),
    AuthModule,
    RbacModule,
    AuditModule,
    TransformationsModule,
  ],
  controllers: [RulesController],
  providers: [
    RuleRepository,
    RuleExecutionRepository,
    RulesService,
    RuleEngineService,
  ],
  exports: [RuleEngineService, RulesService],
})
export class RulesModule {}
