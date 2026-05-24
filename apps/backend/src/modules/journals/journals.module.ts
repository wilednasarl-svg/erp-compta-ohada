import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { OrganizationAccountEntity } from '../accounting-plan/entities/organization-account.entity';
import { EntriesController } from './controllers/entries.controller';
import { JournalsController } from './controllers/journals.controller';
import { PeriodsController } from './controllers/periods.controller';
import {
  AccountingPeriodEntity,
  JournalEntity,
  JournalEntryEntity,
  JournalEntryLineEntity,
} from './entities';
import { AccountingPeriodRepository } from './repositories/accounting-period.repository';
import { JournalEntryLineRepository } from './repositories/journal-entry-line.repository';
import { JournalEntryRepository } from './repositories/journal-entry.repository';
import { JournalRepository } from './repositories/journal.repository';
import { EntriesService } from './services/entries.service';
import { JournalsService } from './services/journals.service';
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
      JournalEntity,
      JournalEntryEntity,
      JournalEntryLineEntity,
      OrganizationAccountEntity,
    ]),
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [PeriodsController, JournalsController, EntriesController],
  providers: [
    AccountingPeriodRepository,
    JournalRepository,
    JournalEntryRepository,
    JournalEntryLineRepository,
    PeriodsService,
    JournalsService,
    EntriesService,
  ],
  exports: [JournalsService, EntriesService, JournalRepository],
})
export class JournalsModule {}
