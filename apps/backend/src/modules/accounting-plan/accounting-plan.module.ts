import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrganizationAccountEntity } from './entities/organization-account.entity';
import { OrganizationAccountingConfigEntity } from './entities/organization-accounting-config.entity';
import { ReferenceAccountEntity } from './entities/reference-account.entity';
import { OrganizationAccountRepository } from './repositories/organization-account.repository';
import { OrganizationAccountingConfigRepository } from './repositories/organization-accounting-config.repository';
import { ReferenceAccountRepository } from './repositories/reference-account.repository';

/**
 * `AccountingPlanModule` — couche données du plan comptable OHADA
 * (Module 2, sections 3-4). Pose les entités et repositories ; les
 * services (`ReferenceChartService`, `ChartOfAccountsService`) et les
 * controllers seront ajoutés aux sections 5-7.
 *
 * Les 3 entités + 3 repositories sont exportés pour que les modules
 * en aval (`OrganizationsModule` qui clonera le plan à la création
 * d'org, le Module 3 qui posera les écritures, le Module 4 qui
 * produira balances et états) puissent les injecter sans recréer la
 * chaîne TypeORM.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReferenceAccountEntity,
      OrganizationAccountEntity,
      OrganizationAccountingConfigEntity,
    ]),
  ],
  providers: [
    ReferenceAccountRepository,
    OrganizationAccountRepository,
    OrganizationAccountingConfigRepository,
  ],
  exports: [
    ReferenceAccountRepository,
    OrganizationAccountRepository,
    OrganizationAccountingConfigRepository,
    TypeOrmModule,
  ],
})
export class AccountingPlanModule {}
