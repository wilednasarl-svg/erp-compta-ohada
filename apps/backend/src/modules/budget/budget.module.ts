import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { JournalEntryLineEntity } from '../journals/entities/journal-entry-line.entity';
import { BudgetAxisEntity } from './entities/budget-axis.entity';
import { BudgetLineEntity } from './entities/budget-line.entity';
import { BudgetAxisRepository } from './repositories/budget-axis.repository';
import { BudgetLineRepository } from './repositories/budget-line.repository';
import { BudgetVarianceRepository } from './repositories/budget-variance.repository';
import { BudgetActualsRepository } from './repositories/budget-actuals.repository';
import { BudgetAxesService } from './services/budget-axes.service';
import { BudgetLinesService } from './services/budget-lines.service';
import { BudgetVarianceService } from './services/budget-variance.service';
import { BudgetTemplateService } from './services/budget-template.service';
import { BudgetImportService } from './services/budget-import.service';
import { BudgetCapexService } from './services/budget-capex.service';
import { BudgetActualsService } from './services/budget-actuals.service';
import { BudgetAxesController } from './controllers/budget-axes.controller';
import { BudgetLinesController } from './controllers/budget-lines.controller';
import { BudgetVarianceController } from './controllers/budget-variance.controller';
import { BudgetTemplateController } from './controllers/budget-template.controller';
import { BudgetCapexController } from './controllers/budget-capex.controller';
import { BudgetActualsController } from './controllers/budget-actuals.controller';

/**
 * Module Budget — budget & contrôle budgétaire (OPEX / CAPEX / Trésorerie /
 * RH), axes analytiques, et moteur d'écarts réalisé vs budget.
 *
 * Voir migrations 0111 (tables) et 0112 (permissions RBAC budget.read/write).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BudgetAxisEntity, BudgetLineEntity, JournalEntryLineEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [
    BudgetAxesController,
    BudgetLinesController,
    BudgetVarianceController,
    BudgetTemplateController,
    BudgetCapexController,
    BudgetActualsController,
  ],
  providers: [
    BudgetAxisRepository,
    BudgetLineRepository,
    BudgetVarianceRepository,
    BudgetActualsRepository,
    BudgetAxesService,
    BudgetLinesService,
    BudgetVarianceService,
    BudgetTemplateService,
    BudgetImportService,
    BudgetCapexService,
    BudgetActualsService,
  ],
  exports: [BudgetAxesService, BudgetLinesService, BudgetVarianceService, BudgetActualsService],
})
export class BudgetModule {}
