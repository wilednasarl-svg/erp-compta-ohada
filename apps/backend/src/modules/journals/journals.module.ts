import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { RbacModule } from '../rbac/rbac.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { OrganizationAccountEntity } from '../accounting-plan/entities/organization-account.entity';
import { OrganizationAccountRepository } from '../accounting-plan/repositories/organization-account.repository';
import { AgingController } from './controllers/aging.controller';
import { TaxBreakdownController } from './controllers/tax-breakdown.controller';
import { EntriesController } from './controllers/entries.controller';
import { EntryWorkflowController } from './controllers/entry-workflow.controller';
import { JournalsController } from './controllers/journals.controller';
import { LetteringsController } from './controllers/letterings.controller';
import { PeriodsController } from './controllers/periods.controller';
import { SignatureVerifyController } from './controllers/signature-verify.controller';
import {
  AccountingPeriodEntity,
  EntrySignatureEntity,
  JournalEntity,
  JournalEntryEntity,
  JournalEntryLineEntity,
  PartnerLetteringEntity,
} from './entities';
import { AccountingPeriodRepository } from './repositories/accounting-period.repository';
import { EntrySignatureRepository } from './repositories/entry-signature.repository';
import { JournalEntryLineRepository } from './repositories/journal-entry-line.repository';
import { JournalEntryRepository } from './repositories/journal-entry.repository';
import { JournalRepository } from './repositories/journal.repository';
import { PartnerLetteringRepository } from './repositories/partner-lettering.repository';
import { EntriesService } from './services/entries.service';
import { EntryNotificationService } from './services/entry-notification.service';
import { EntryPdfGenerator } from './services/entry-pdf-generator';
import { EntryWorkflowService } from './services/entry-workflow.service';
import { AgingService } from './services/aging.service';
import { TaxBreakdownService } from './services/tax-breakdown.service';
import { JournalsService } from './services/journals.service';
import { LetteringService } from './services/lettering.service';
import { PeriodsService } from './services/periods.service';

/**
 * JournalsModule — Module 4 Journals & Entries.
 *
 * Wave 1 :
 *   - 4 entites TypeORM : AccountingPeriod, Journal, JournalEntry, JournalEntryLine
 *   - 4 repositories tenant-scopes
 *   - 3 services : PeriodsService, JournalsService, EntriesService
 *   - 3 controllers REST (periodes, journaux, ecritures)
 *
 * Wave 2 (Module 14 — workflow + signatures) :
 *   - EntryWorkflowService / EntryWorkflowController
 *   - EntryPdfGenerator : génère le PDF de l'écriture validée
 *   - EntryNotificationService : email à chaque transition (chef_mission,
 *     expert_comptable, créateur). Importe EmailModule + RbacModule (pour
 *     MembershipRepository + RoleRepository), AuthModule (UserRepository).
 *   - SignatureVerifyController : endpoint PUBLIC `GET /verify-signature/:id`.
 *
 * `OrganizationAccountRepository` est déclaré en provider local pour
 * éviter d'importer `AccountingPlanModule` (cycle potentiel) — l'entité
 * est déjà enregistrée plus haut via `TypeOrmModule.forFeature`.
 *
 * JournalsService est exporte pour permettre a OrganizationsService de
 * seeder les 5 journaux SYSCOHADA a la creation d une org.
 *
 * EntriesService est exporte pour Module 3 (commitSession) et Module 5 (RuleEngine).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountingPeriodEntity,
      EntrySignatureEntity,
      JournalEntity,
      JournalEntryEntity,
      JournalEntryLineEntity,
      PartnerLetteringEntity,
      OrganizationAccountEntity,
    ]),
    AuthModule,
    RbacModule,
    AuditModule,
    // Module 14 — réutilise WorkflowService (Module 6) pour le cycle
    // d'approbation des écritures (targetType 'journal_entry').
    WorkflowsModule,
    // Module 14 wave 2 — emails de notification + PDF signé en pièce
    // jointe via EmailService.sendMail.
    EmailModule,
  ],
  controllers: [
    PeriodsController,
    JournalsController,
    EntriesController,
    LetteringsController,
    AgingController,
    TaxBreakdownController,
    EntryWorkflowController,
    SignatureVerifyController,
  ],
  providers: [
    AccountingPeriodRepository,
    JournalRepository,
    JournalEntryRepository,
    JournalEntryLineRepository,
    PartnerLetteringRepository,
    EntrySignatureRepository,
    OrganizationAccountRepository,
    PeriodsService,
    JournalsService,
    EntriesService,
    LetteringService,
    AgingService,
    TaxBreakdownService,
    EntryWorkflowService,
    EntryPdfGenerator,
    EntryNotificationService,
  ],
  exports: [
    JournalsService,
    EntriesService,
    LetteringService,
    JournalRepository,
    JournalEntryRepository,
    EntryWorkflowService,
    // AccountingPeriodRepository : consommé par DashboardsModule (M19),
    // AssetsModule (M12), AiModule (M11), AccountingScoreModule (M20) —
    // tous bornent une fenêtre temporelle via l'exercice. Sans cet
    // export Nest crash au boot : "AccountingPeriodRepository at index
    // [N] is not available in the <X>Module context".
    AccountingPeriodRepository,
  ],
})
export class JournalsModule {}
