import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { RbacModule } from '../rbac/rbac.module';
import { CashFlowController } from './controllers/cash-flow.controller';
import { CashFlowForecastEntity } from './entities/cash-flow-forecast.entity';
import { CashFlowForecastRepository } from './repositories/cash-flow-forecast.repository';
import { CashFlowService } from './services/cash-flow.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CashFlowForecastEntity]),
    AuthModule,
    RbacModule,
    DashboardsModule,
  ],
  controllers: [CashFlowController],
  providers: [CashFlowForecastRepository, CashFlowService],
  exports: [CashFlowService],
})
export class CashFlowModule {}
