import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { JournalEntryLineEntity } from '../journals/entities/journal-entry-line.entity';
import { JournalsModule } from '../journals/journals.module';
import { RbacModule } from '../rbac/rbac.module';
import { ReportsController } from './controllers/reports.controller';
import { FiscalYearSnapshotEntity } from './entities/fiscal-year-snapshot.entity';
import { NoteAnnexeCommentEntity } from './entities/note-annexe-comment.entity';
import { SubsequentEventEntity } from './entities/subsequent-event.entity';
import { FiscalYearSnapshotsRepository } from './repositories/fiscal-year-snapshots.repository';
import { NoteAnnexeCommentsRepository } from './repositories/note-annexe-comments.repository';
import { ReportsRepository } from './repositories/reports.repository';
import { SubsequentEventsRepository } from './repositories/subsequent-events.repository';
import { DsfValidatorService } from './services/dsf-validator.service';
import { FiscalYearSnapshotsService } from './services/fiscal-year-snapshots.service';
import { ReportsPackageService } from './services/reports-package.service';
import { ReportsPdfService } from './services/reports-pdf.service';
import { ReportsService } from './services/reports.service';
import { ReportsXlsxService } from './services/reports-xlsx.service';
import { SubsequentEventsService } from './services/subsequent-events.service';

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
    TypeOrmModule.forFeature([
      JournalEntryLineEntity,
      NoteAnnexeCommentEntity,
      FiscalYearSnapshotEntity,
      SubsequentEventEntity,
    ]),
    AuthModule,
    RbacModule,
    AuditModule,
    AccountingPlanModule,
    JournalsModule,
  ],
  controllers: [ReportsController],
  providers: [
    ReportsRepository,
    NoteAnnexeCommentsRepository,
    FiscalYearSnapshotsRepository,
    SubsequentEventsRepository,
    ReportsService,
    ReportsPdfService,
    ReportsXlsxService,
    ReportsPackageService,
    DsfValidatorService,
    FiscalYearSnapshotsService,
    SubsequentEventsService,
  ],
  exports: [
    ReportsService,
    DsfValidatorService,
    FiscalYearSnapshotsService,
    SubsequentEventsService,
  ],
})
export class ReportsModule {}
