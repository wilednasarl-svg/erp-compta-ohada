import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { JournalEntryLineEntity } from '../journals/entities/journal-entry-line.entity';
import { JournalsModule } from '../journals/journals.module';
import { RbacModule } from '../rbac/rbac.module';
import { DashboardsController } from './controllers/dashboards.controller';
import { DashboardsRepository } from './repositories/dashboards.repository';
import { DashboardAgingService } from './services/dashboard-aging.service';
import { DashboardSummaryService } from './services/dashboard-summary.service';

/**
 * `DashboardsModule` — Module 19 wave 1 : endpoints d'agrégation
 * pour les écrans de dashboards comptables côté frontend.
 *
 * Compose :
 *   - `DashboardsRepository`     : SQL agrégatifs sur `journal_entry_lines`
 *     (joints à `journal_entries` + `organization_chart_accounts`).
 *     Pas de duplication avec `ReportsRepository` — celui-ci sert les
 *     états formels (balance, GL, P&L, bilan), Dashboards expose des
 *     vues synthétiques orientées KPI/chart.
 *   - `DashboardSummaryService`  : overview KPIs (cash, AR, AP, YTD,
 *     ratios, breakdown par classe).
 *   - `DashboardAgingService`    : balance âgée clients/fournisseurs
 *     basée sur les lignes NON-LETTRÉES (les lignes lettrées sont
 *     compensées → exclues).
 *   - `DashboardsController`     : REST GET-only sous
 *     `/organizations/:id/dashboards/`.
 *
 * Imports modules :
 *   - `AuthModule` + `RbacModule` pour les guards (cf. memory
 *     `nest-useguards-requires-module-imports`).
 *   - `AuditModule` pour l'émission des events `view_summary` /
 *     `view_aging`.
 *   - `JournalsModule` pour `AccountingPeriodRepository` —
 *     les deux services exigent un `accounting_period` racine pour
 *     borner la fenêtre temporelle.
 *
 * Pas d'export : ce module est terminal, aucun autre module n'a
 * besoin d'agréger des KPIs en interne.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([JournalEntryLineEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
    JournalsModule,
  ],
  controllers: [DashboardsController],
  providers: [DashboardsRepository, DashboardSummaryService, DashboardAgingService],
})
export class DashboardsModule {}
