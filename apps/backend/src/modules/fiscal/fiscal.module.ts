import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { FiscalParameterEntity } from './entities/fiscal-parameter.entity';
import { FiscalDeclarationEntity } from './entities/fiscal-declaration.entity';
import { FiscalParameterRepository } from './repositories/fiscal-parameter.repository';
import { FiscalDeclarationRepository } from './repositories/fiscal-declaration.repository';
import { FiscalParametersService } from './services/fiscal-parameters.service';
import { FiscalDeclarationsService } from './services/fiscal-declarations.service';
import { FiscalParametersController } from './controllers/fiscal-parameters.controller';
import { FiscalDeclarationsController } from './controllers/fiscal-declarations.controller';

/**
 * Module Fiscal & Social — déclarations fiscales/sociales (CI).
 *
 * Socle transverse : paramètres de taux versionnés (PARAMÈTRES) + générateur
 * de déclarations échéancées branché sur les bases comptables/budget.
 * Voir migrations 0113 (tables) et 0114 (permissions fiscal.read/write).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FiscalParameterEntity, FiscalDeclarationEntity]),
    AuthModule,
    RbacModule,
  ],
  controllers: [FiscalParametersController, FiscalDeclarationsController],
  providers: [
    FiscalParameterRepository,
    FiscalDeclarationRepository,
    FiscalParametersService,
    FiscalDeclarationsService,
  ],
  exports: [FiscalParametersService, FiscalDeclarationsService],
})
export class FiscalModule {}
