import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { LoggerModule } from './common/logging/logger.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { configuration } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { AccountingPlanModule } from './modules/accounting-plan/accounting-plan.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ImportsModule } from './modules/imports/imports.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { JournalsModule } from './modules/journals/journals.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RulesModule } from './modules/rules/rules.module';
import { TransformationsModule } from './modules/transformations/transformations.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { TvaModule } from './modules/tva/tva.module';
// Module 12 (AssetsModule), Module 14 (JournalSignaturesModule, déplacé
// dans JournalsModule via EntryWorkflowService) et Module 15
// (BankReconciliationModule) sont en cours de reconstruction parallèle
// (issues bd projet-ferme-2fo + suivantes). On les recâble ici dès que
// `assets.module.ts` et `bank-reconciliation.module.ts` sont re-livrés.
// Les entités, services et migrations existants ne sont pas chargés tant
// qu'aucun module ne les référence — Nest n'enregistre rien d'orphelin.

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
    }),
    // LoggerModule registers `pino-http` as a global Express middleware.
    // It MUST be imported AFTER ConfigModule (it consumes ConfigService)
    // and we apply `RequestIdMiddleware` first in `configure()` so the
    // logger picks up `req.id` from a stable correlation id.
    LoggerModule,
    DatabaseModule,
    HealthModule,
    // Module 1 feature modules. They each register their entities with
    // `TypeOrmModule.forFeature([...])` and expose typed repositories that
    // enforce the multi-tenant invariant (BE-DB-11).
    OrganizationsModule,
    AuthModule,
    RbacModule,
    AuditModule,
    // Module 2 (couche données — services et controllers à venir).
    // Pose les entités + repositories du plan comptable OHADA SYSCOHADA
    // AUDCIF : référentiel global + plans personnalisés par organisation.
    AccountingPlanModule,
    // Module 3 wave 1 — Import engine. Sessions d'import, upload de
    // fichiers (CSV / XLSX / Sage), parsing en staging, mapping
    // automatique des colonnes, validation des lignes et preview.
    // Le commit définitif vers les tables comptables réelles arrivera
    // en vague 2 / Module 4.
    ImportsModule,
    // Module 4 — Journals & Entries. Coeur comptable SYSCOHADA AUDCIF :
    // journaux, ecritures double-partie, periodes comptables, invariant
    // d'equilibre, machine a etats draft/validated/cancelled,
    // contre-passation, numeros de piece sequentiels et immutables.
    // Embarque aussi Module 14 wave 1 (EntryWorkflow + signatures) en
    // tirant sur `WorkflowsModule` pour la cible 'journal_entry'.
    JournalsModule,
    // Module 4 wave 1 — Transformation Engine. Retraitement comptable :
    // reclassement, ajustement, historique. Les écritures sources
    // (import_staging_entries) restent immutables ; chaque transformation
    // est un artefact supplémentaire tracé et auditable.
    TransformationsModule,
    // Module 5 wave 1 — Rule Engine. Règles d'automatisation comptable :
    // conditions JSONB (compte, journal, montant, date, libellé) + actions
    // (reclassement, centre de coûts, tag). Simulate avant apply, toutes
    // les mutations passent par TransformationService (Module 4).
    RulesModule,
    // Module 6 wave 1 — Workflow engine. Validation multi-niveaux :
    // draft → in_review → approved → locked. Cible vague 1 : import_session.
    // `WorkflowService` est exporté pour que d'autres modules puissent
    // appeler `assertNotLocked` (invariant fort sur l'état `locked`).
    WorkflowsModule,
    // Module 10 wave 1 — Document engine. Upload / store / list /
    // soft-delete pour les pièces comptables (factures, contrats,
    // justificatifs) avec un `DocumentStorageService` abstrait (driver
    // local-FS par défaut) et un hook OCR stub à câbler en vague 2.
    DocumentsModule,
    // Module 9 — Financial reports. Balance générale + grand livre,
    // compte de résultat + bilan, exports PDF/Excel.
    ReportsModule,
    // Module 13 wave 1 — TVA & Déclarations fiscales.
    TvaModule,
  ],
  controllers: [],
  providers: [
    // BE-RBAC-06 — deny-by-default authentication. `JwtAuthGuard` is
    // registered as an `APP_GUARD` so EVERY request must carry a valid
    // Bearer access token unless the handler is annotated `@Public()`
    // (signup, login, refresh, accept-invitation, mfa/verify-challenge).
    // `TenantGuard`, `PermissionsGuard`, `RolesGuard` stay opt-in via
    // per-controller `@UseGuards` — they need a tenant scope which
    // public/onboarding routes don't have, and mounting them globally
    // would force every route to opt out via a third decorator.
    //
    // `useExisting` re-uses the singleton instance registered by
    // `AuthModule.providers`, so it shares the same `JwtTokenService`
    // injection without re-wiring the dependency graph.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order matters: `RequestIdMiddleware` first so `pino-http` picks up
    // the correlation id; `RequestContextMiddleware` second so
    // `req.context.ip` / `req.context.userAgent` are available to every
    // downstream guard / interceptor / controller.
    consumer.apply(RequestIdMiddleware, RequestContextMiddleware).forRoutes('*');
  }
}
