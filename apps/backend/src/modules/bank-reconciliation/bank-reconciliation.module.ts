import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { JournalsModule } from '../journals/journals.module';
import { MultiCurrencyModule } from '../multi-currency/multi-currency.module';
import { RbacModule } from '../rbac/rbac.module';
import { BankAccountsController } from './controllers/bank-accounts.controller';
import { BankReconciliationController } from './controllers/bank-reconciliation.controller';
import { BankStatementsController } from './controllers/bank-statements.controller';
import { BankAccountEntity } from './entities/bank-account.entity';
import { BankReconciliationMatchEntity } from './entities/bank-reconciliation-match.entity';
import { BankStatementEntity } from './entities/bank-statement.entity';
import { BankStatementLineEntity } from './entities/bank-statement-line.entity';
import { BankAccountsRepository } from './repositories/bank-accounts.repository';
import { BankReconciliationMatchesRepository } from './repositories/bank-reconciliation-matches.repository';
import { BankStatementLinesRepository } from './repositories/bank-statement-lines.repository';
import { BankStatementsRepository } from './repositories/bank-statements.repository';
import { BankAccountsService } from './services/bank-accounts.service';
import { BankReconciliationService } from './services/bank-reconciliation.service';
import { BankStatementsService } from './services/bank-statements.service';

/**
 * BankReconciliationModule — Module 15 wave 1 (Rapprochement bancaire).
 *
 * Composants livrés :
 *   - CRUD bank_accounts (création + lecture, update/close en wave 2).
 *   - Import CSV de relevés bancaires avec idempotence par SHA-256.
 *   - Auto-matching algorithmique (montant + date ±5j + Jaro-Winkler libellé).
 *   - Matching manuel (1:1) + unmatch avec recalcul des compteurs.
 *
 * Dépend de :
 *   - AccountingPlanModule (OrganizationAccountRepository — validation FK
 *     vers le compte SYSCOHADA 521x lors de la création d'un bank_account).
 *   - JournalsModule (entités JournalEntryEntity / JournalEntryLineEntity
 *     pour les requêtes de candidats au matching).
 *   - AuthModule + RbacModule (guards JWT / tenant / permission — cf.
 *     mémoire `nest-useguards-requires-module-imports`).
 *   - AuditModule (audit trail).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BankAccountEntity,
      BankStatementEntity,
      BankStatementLineEntity,
      BankReconciliationMatchEntity,
    ]),
    AuthModule,
    RbacModule,
    AuditModule,
    AccountingPlanModule,
    JournalsModule,
    MultiCurrencyModule,
  ],
  controllers: [
    BankAccountsController,
    BankStatementsController,
    BankReconciliationController,
  ],
  providers: [
    BankAccountsRepository,
    BankStatementsRepository,
    BankStatementLinesRepository,
    BankReconciliationMatchesRepository,
    BankAccountsService,
    BankStatementsService,
    BankReconciliationService,
  ],
  exports: [BankAccountsService, BankStatementsService, BankReconciliationService],
})
export class BankReconciliationModule {}
