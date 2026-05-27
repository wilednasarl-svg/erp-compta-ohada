import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashFlowForecastEntity } from './entities/cash-flow-forecast.entity';
import { CashFlowForecastRepository } from './repositories/cash-flow-forecast.repository';
import { CashFlowService } from './services/cash-flow.service';
import { CashFlowController } from './controllers/cash-flow.controller';
import { DashboardsModule } from '../dashboards/dashboards.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CashFlowForecastEntity]),
    DashboardsModule, // To use DashboardsRepository
  ],
  controllers: [CashFlowController],
  providers: [CashFlowForecastRepository, CashFlowService],
  exports: [CashFlowService],
})
export class CashFlowModule {}
