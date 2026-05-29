import { Injectable, NotFoundException } from '@nestjs/common';
import { CashFlowForecastRepository } from '../repositories/cash-flow-forecast.repository';
import {
  CashFlowForecastEntity,
  CashFlowForecastStatus,
} from '../entities/cash-flow-forecast.entity';
import {
  CreateCashFlowForecastDto,
  UpdateCashFlowForecastDto,
} from '../dto/cash-flow-forecast.dto';
import { DashboardsRepository } from '../../dashboards/repositories/dashboards.repository';
import { asTenantId } from '../../../common/persistence/tenant-scope';

export interface CashFlowProjection {
  date: string;
  expectedBalance: string;
  inflows: string;
  outflows: string;
}

export interface CashFlowForecastReport {
  currentCashBalance: string;
  projections: CashFlowProjection[];
}

@Injectable()
export class CashFlowService {
  constructor(
    private readonly forecastRepo: CashFlowForecastRepository,
    private readonly dashRepo: DashboardsRepository,
  ) {}

  async createForecast(
    organizationId: string,
    dto: CreateCashFlowForecastDto,
    userId?: string,
  ): Promise<CashFlowForecastEntity> {
    return this.forecastRepo.create({
      organizationId,
      ...dto,
      createdById: userId,
    });
  }

  async findAllForOrganization(
    organizationId: string,
    status?: CashFlowForecastStatus,
  ): Promise<CashFlowForecastEntity[]> {
    return this.forecastRepo.findAllForOrganization(organizationId, status);
  }

  async updateForecast(
    organizationId: string,
    id: string,
    dto: UpdateCashFlowForecastDto,
  ): Promise<CashFlowForecastEntity> {
    const forecast = await this.forecastRepo.findById(id, organizationId);
    if (!forecast) {
      throw new NotFoundException(`Forecast with id ${id} not found`);
    }

    await this.forecastRepo.update(id, dto);
    return this.forecastRepo.findById(id, organizationId) as Promise<CashFlowForecastEntity>;
  }

  async deleteForecast(organizationId: string, id: string): Promise<void> {
    const forecast = await this.forecastRepo.findById(id, organizationId);
    if (!forecast) {
      throw new NotFoundException(`Forecast with id ${id} not found`);
    }

    await this.forecastRepo.delete(id, organizationId);
  }

  /**
   * Génère une projection de la trésorerie sur les prochains jours.
   * On part du solde de trésorerie actuel (aujourd'hui) et on applique
   * les prévisions "pending" jour par jour.
   */
  async getProjection(
    organizationId: string,
    daysAhead: number = 90,
  ): Promise<CashFlowForecastReport> {
    const today = new Date().toISOString().split('T')[0];

    // 1. Solde instantané aujour'dhui
    const cashAgg = await this.dashRepo.aggregateByCodePrefix(asTenantId(organizationId), today, [
      '51',
      '53',
      '57',
    ]);

    const currentCashBalance = (Number(cashAgg.totalDebit) - Number(cashAgg.totalCredit)).toFixed(
      2,
    );

    // 2. Fetch pending forecasts
    const pendingForecasts = await this.forecastRepo.findAllForOrganization(
      organizationId,
      'pending',
    );

    // On groupe les prévisions par date
    const forecastByDate = new Map<string, { inflows: number; outflows: number }>();

    for (const f of pendingForecasts) {
      if (f.expectedDate < today) continue; // On ignore les prévisions passées non réalisées pour la projection future ou on les met à aujourd'hui ? On va les inclure à aujourd'hui pour rattrapage
      const dateKey = f.expectedDate < today ? today : f.expectedDate;

      const current = forecastByDate.get(dateKey) || { inflows: 0, outflows: 0 };
      if (f.type === 'inflow') {
        current.inflows += Number(f.amount);
      } else {
        current.outflows += Number(f.amount);
      }
      forecastByDate.set(dateKey, current);
    }

    // 3. Calculer les projections jour par jour
    const projections: CashFlowProjection[] = [];
    let runningBalance = Number(currentCashBalance);

    const currentDate = new Date();

    for (let i = 0; i <= daysAhead; i++) {
      const iterDate = new Date(currentDate);
      iterDate.setDate(currentDate.getDate() + i);
      const dateStr = iterDate.toISOString().split('T')[0];

      const dayData = forecastByDate.get(dateStr) || { inflows: 0, outflows: 0 };

      runningBalance = runningBalance + dayData.inflows - dayData.outflows;

      projections.push({
        date: dateStr,
        inflows: dayData.inflows.toFixed(2),
        outflows: dayData.outflows.toFixed(2),
        expectedBalance: runningBalance.toFixed(2),
      });
    }

    return {
      currentCashBalance,
      projections,
    };
  }
}
