import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

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
import { AssetsModule } from './modules/assets/assets.module';
import { MultiCurrencyModule } from './modules/multi-currency/multi-currency.module';
import { BankReconciliationModule } from './modules/bank-reconciliation/bank-reconciliation.module';
import { AiModule } from './modules/ai/ai.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AccountingScoreModule } from './modules/accounting-score/accounting-score.module';
import { CollaborationModule } from './modules/collaboration/collaboration.module';
import { EmailModule } from './modules/email/email.module';
// Module 14 (signatures électroniques) est embarqué dans JournalsModule
// via EntryWorkflowService — pas de module séparé.

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
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
    // Module 12 wave 1 — Immobilisations & Amortissements SYSCOHADA.
    // Registre des assets, calcul d'échéancier (linéaire / dégressif),
    // comptabilisation des dotations comme écritures journal via
    // EntriesService (Module 4). Permissions : assets.read, assets.write,
    // assets.post_depreciation.
    AssetsModule,
    // Module 16 wave 1 — Multi-devises (XOF base UEMOA). Catalogue
    // ISO 4217 par organisation + historique des taux de change +
    // conversion pure. Exporte CurrenciesService + ExchangeRatesService
    // pour futur impact FX sur journals (wave 2) et banking
    // multi-devises (Module 15 wave 2). Pas d'AuditModule en wave 1.
    MultiCurrencyModule,
    // Module 15 wave 1 — Rapprochement bancaire SYSCOHADA. Import CSV
    // de relevés, auto-matching (Jaro-Winkler sur libellé + montant
    // exact ±5j), matching manuel 1:1. BankReconciliationModule importe
    // AuditModule en interne (TenantGuard a besoin d'AuthEventsService).
    // Permissions : bank.read, bank.import, bank.reconcile, bank.admin.
    BankReconciliationModule,
    // Module 11 wave 1 — AI Engine. Heuristiques déterministes pour
    // détecter les anomalies GL (montants extrêmes, comptes sensibles,
    // doublons, dates suspectes, combinaisons rares) et suggérer un
    // compte sur saisie (pattern-matching + historique majoritaire).
    // Aucun appel ML / LLM externe en wave 1 — design prêt pour
    // remplacer la couche heuristique par un modèle en wave 2.
    // Permissions : ai.scan, ai.read, ai.suggest.
    AiModule,
    // Module 19 wave 1 — Dashboards comptables. Endpoints d'agrégation
    // orientés UI (summary KPIs, aging clients/fournisseurs). Pas
    // d'export PDF/PNG en wave 1 — JSON consommé par Recharts côté
    // Next.js. Permission unique : dashboards.read (tous rôles métier).
    DashboardsModule,
    // Module 17 wave 1 — Inventaire & Stock. Registre articles +
    // mouvements append-only + valorisation CMP SYSCOHADA. Importe
    // AccountingPlanModule pour valider l'appartenance tenant des
    // 3 comptes (31x stock, 60x achat, 70x vente). Les guards
    // (TenantGuard) résolvent AuthEventsService via RbacModule →
    // forwardRef(AuditModule). Pas d'audit direct côté service en
    // wave 1 — l'invariant cross-tenant est porté par TenantGuard +
    // OrganizationAccountRepository.findById.
    // Permissions : inventory.read, inventory.write, inventory.movement.
    InventoryModule,
    // Module 20 wave 1 — Accounting Score. Score de santé comptable
    // 0-100 par exercice agrégé sur 4 critères pondérés (anomalies,
    // justificatifs manquants, rapprochements bancaires, retards
    // workflow). Heuristique pure (wave 1) — loose-coupling SQL brut
    // sur ai_anomalies / document_entries / bank_statement_lines /
    // accounting_periods, donc le module compile et tourne même sans
    // Module 11 / 15 cablés dans la DB cible. Permissions :
    // accounting_score.recalculate, accounting_score.read.
    AccountingScoreModule,
    // Module 21 wave 1 — Collaboration cabinet ↔ client. Demandes de
    // pièces justificatives + commentaires fils. State machine
    // open → answered → closed. Notifications stubbées (logger) en
    // wave 1 — emails + websocket arrivent en wave 2. Permissions :
    // collaboration.read, collaboration.write, collaboration.respond.
    CollaborationModule,
    // Email — outbound mail + rappels TVA cron J-7/J-1.
    EmailModule,
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
