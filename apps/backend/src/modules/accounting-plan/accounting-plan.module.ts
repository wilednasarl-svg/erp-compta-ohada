import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { OrganizationAccountEntity } from './entities/organization-account.entity';
import { OrganizationAccountingConfigEntity } from './entities/organization-accounting-config.entity';
import { ReferenceAccountEntity } from './entities/reference-account.entity';
import { OrganizationAccountRepository } from './repositories/organization-account.repository';
import { OrganizationAccountingConfigRepository } from './repositories/organization-accounting-config.repository';
import { ReferenceAccountRepository } from './repositories/reference-account.repository';
import { ChartOfAccountsService } from './services/chart-of-accounts.service';
import { ReferenceChartService } from './services/reference-chart.service';

/**
 * `AccountingPlanModule` — Module 2 du plan : entités, repositories et
 * services du plan comptable OHADA. Les controllers (BE-PC-07) et
 * l'intégration `OrganizationsService.create` (BE-PC-08) seront branchés
 * dans une étape suivante.
 *
 * Les services et repositories sont ré-exportés pour que les modules
 * en aval (`OrganizationsModule` qui appellera `cloneReferenceIntoOrganization`
 * à la création d'org, le Module 3 qui posera les écritures, le
 * Module 4 qui produira balances et états) puissent les injecter sans
 * recréer la chaîne TypeORM.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReferenceAccountEntity,
      OrganizationAccountEntity,
      OrganizationAccountingConfigEntity,
    ]),
    AuditModule,
  ],
  providers: [
    ReferenceAccountRepository,
    OrganizationAccountRepository,
    OrganizationAccountingConfigRepository,
    ReferenceChartService,
    ChartOfAccountsService,
  ],
  // NOTE: `TypeOrmModule` is intentionally NOT re-exported. The
  // `ReferenceAccountEntity` table is meant to be read-only at the API
  // layer — exposing the raw repository via `TypeOrmModule` would let
  // downstream modules call `.save()` / `.delete()` directly, bypassing
  // `ReferenceAccountRepository`'s curated read-only surface. Downstream
  // modules (e.g. `OrganizationsModule` for the clone path) get
  // everything they need through the three injected repository providers
  // and `ChartOfAccountsService` below.
  exports: [
    ReferenceAccountRepository,
    OrganizationAccountRepository,
    OrganizationAccountingConfigRepository,
    ReferenceChartService,
    ChartOfAccountsService,
  ],
})
export class AccountingPlanModule {}
