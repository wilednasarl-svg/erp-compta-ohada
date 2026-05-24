import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { JournalEntryLineEntity } from '../journals/entities/journal-entry-line.entity';
import { RbacModule } from '../rbac/rbac.module';
import { ReportsController } from './controllers/reports.controller';
import { ReportsRepository } from './repositories/reports.repository';
import { ReportsPdfService } from './services/reports-pdf.service';
import { ReportsService } from './services/reports.service';
import { ReportsXlsxService } from './services/reports-xlsx.service';

/**
 * `ReportsModule` — Module 9 financial reports (waves 1-3).
 *
 * Composes:
 *   - `ReportsRepository` for raw SQL aggregations against
 *     `journal_entry_lines` (joined with entries + accounts).
 *   - `ReportsService` for business-level projection + running balance.
 *   - `ReportsPdfService` for PDF rendering (wave 3).
 *   - `ReportsXlsxService` for Excel export (wave 3).
 *   - `ReportsController` for the REST surface (JSON + PDF/XLSX).
 *
 * AuthModule + RbacModule are imported for the controller's
 * `@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)` —
 * see memory `nest-useguards-requires-module-imports` for why both
 * imports are necessary even with APP_GUARD globally registered.
 *
 * AccountingPlanModule is imported so `OrganizationAccountRepository`
 * is available to verify the requested account exists in this tenant
 * before serving the general-ledger drill-down.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([JournalEntryLineEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
    AccountingPlanModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsRepository, ReportsService, ReportsPdfService, ReportsXlsxService],
  exports: [ReportsService],
})
export class ReportsModule {}
