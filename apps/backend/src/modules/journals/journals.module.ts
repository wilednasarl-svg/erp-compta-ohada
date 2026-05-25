import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { OrganizationAccountEntity } from '../accounting-plan/entities/organization-account.entity';
import { EntriesController } from './controllers/entries.controller';
import { EntryWorkflowController } from './controllers/entry-workflow.controller';
import { JournalsController } from './controllers/journals.controller';
import { LetteringsController } from './controllers/letterings.controller';
import { PeriodsController } from './controllers/periods.controller';
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
import { EntryWorkflowService } from './services/entry-workflow.service';
import { JournalsService } from './services/journals.service';
import { LetteringService } from './services/lettering.service';
import { PeriodsService } from './services/periods.service';

/**
 * JournalsModule — Module 4 Journals & Entries (wave 1).
 *
 * Compose :
 *   - 4 entites TypeORM : AccountingPeriod, Journal, JournalEntry, JournalEntryLine
 *   - 4 repositories tenant-scopes
 *   - 3 services : PeriodsService, JournalsService, EntriesService
 *   - 3 controllers REST (periodes, journaux, ecritures)
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
  ],
  controllers: [
    PeriodsController,
    JournalsController,
    EntriesController,
    LetteringsController,
    EntryWorkflowController,
  ],
  providers: [
    AccountingPeriodRepository,
    JournalRepository,
    JournalEntryRepository,
    JournalEntryLineRepository,
    PartnerLetteringRepository,
    EntrySignatureRepository,
    PeriodsService,
    JournalsService,
    EntriesService,
    LetteringService,
    EntryWorkflowService,
  ],
  exports: [
    JournalsService,
    EntriesService,
    LetteringService,
    JournalRepository,
    EntryWorkflowService,
  ],
})
export class JournalsModule {}
