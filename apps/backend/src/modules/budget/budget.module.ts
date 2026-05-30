import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { BudgetAxisEntity } from './entities/budget-axis.entity';
import { BudgetLineEntity } from './entities/budget-line.entity';
import { BudgetAxisRepository } from './repositories/budget-axis.repository';
import { BudgetLineRepository } from './repositories/budget-line.repository';
import { BudgetVarianceRepository } from './repositories/budget-variance.repository';
import { BudgetAxesService } from './services/budget-axes.service';
import { BudgetLinesService } from './services/budget-lines.service';
import { BudgetVarianceService } from './services/budget-variance.service';
import { BudgetAxesController } from './controllers/budget-axes.controller';
import { BudgetLinesController } from './controllers/budget-lines.controller';
import { BudgetVarianceController } from './controllers/budget-variance.controller';

/**
 * Module Budget — budget & contrôle budgétaire (OPEX / CAPEX / Trésorerie /
 * RH), axes analytiques, et moteur d'écarts réalisé vs budget.
 *
 * Voir migrations 0111 (tables) et 0112 (permissions RBAC budget.read/write).
 */
@Module({
  imports: [TypeOrmModule.forFeature([BudgetAxisEntity, BudgetLineEntity]), AuthModule, RbacModule],
  controllers: [BudgetAxesController, BudgetLinesController, BudgetVarianceController],
  providers: [
    BudgetAxisRepository,
    BudgetLineRepository,
    BudgetVarianceRepository,
    BudgetAxesService,
    BudgetLinesService,
    BudgetVarianceService,
  ],
  exports: [BudgetAxesService, BudgetLinesService, BudgetVarianceService],
})
export class BudgetModule {}
