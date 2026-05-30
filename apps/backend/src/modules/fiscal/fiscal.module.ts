import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { BudgetModule } from '../budget/budget.module';
import { JournalEntryLineEntity } from '../journals/entities/journal-entry-line.entity';
import { FiscalParameterEntity } from './entities/fiscal-parameter.entity';
import { FiscalDeclarationEntity } from './entities/fiscal-declaration.entity';
import { FiscalTaxBracketEntity } from './entities/fiscal-tax-bracket.entity';
import { SocialPayrollLineEntity } from './entities/social-payroll-line.entity';
import { FiscalParameterRepository } from './repositories/fiscal-parameter.repository';
import { FiscalDeclarationRepository } from './repositories/fiscal-declaration.repository';
import { FiscalBaseRepository } from './repositories/fiscal-base.repository';
import { FiscalTaxBracketRepository } from './repositories/fiscal-tax-bracket.repository';
import { SocialPayrollRepository } from './repositories/social-payroll.repository';
import { FiscalParametersService } from './services/fiscal-parameters.service';
import { FiscalDeclarationsService } from './services/fiscal-declarations.service';
import { FiscalBaseService } from './services/fiscal-base.service';
import { FiscalBracketsService } from './services/fiscal-brackets.service';
import { SocialPayrollService } from './services/social-payroll.service';
import { FiscalParametersController } from './controllers/fiscal-parameters.controller';
import { FiscalDeclarationsController } from './controllers/fiscal-declarations.controller';
import { FiscalBracketsController } from './controllers/fiscal-brackets.controller';
import { SocialPayrollController } from './controllers/social-payroll.controller';

/**
 * Module Fiscal & Social — déclarations fiscales/sociales (CI).
 *
 * Socle transverse : paramètres de taux versionnés (PARAMÈTRES) + générateur
 * de déclarations échéancées branché sur les bases comptables/budget.
 * Voir migrations 0113 (tables) et 0114 (permissions fiscal.read/write).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FiscalParameterEntity,
      FiscalDeclarationEntity,
      FiscalTaxBracketEntity,
      SocialPayrollLineEntity,
      JournalEntryLineEntity,
    ]),
    AuthModule,
    RbacModule,
    BudgetModule,
  ],
  controllers: [
    FiscalParametersController,
    FiscalDeclarationsController,
    FiscalBracketsController,
    SocialPayrollController,
  ],
  providers: [
    FiscalParameterRepository,
    FiscalDeclarationRepository,
    FiscalBaseRepository,
    FiscalTaxBracketRepository,
    SocialPayrollRepository,
    FiscalParametersService,
    FiscalDeclarationsService,
    FiscalBaseService,
    FiscalBracketsService,
    SocialPayrollService,
  ],
  exports: [FiscalParametersService, FiscalDeclarationsService],
})
export class FiscalModule {}
