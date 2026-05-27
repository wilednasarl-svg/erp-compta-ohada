import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { CashFlowService, CashFlowForecastReport } from '../services/cash-flow.service';
import {
  CreateCashFlowForecastDto,
  UpdateCashFlowForecastDto,
  CashFlowForecastResponseDto,
} from '../dto/cash-flow-forecast.dto';

@Controller('organizations/:orgId/cash-flow')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CashFlowController {
  constructor(private readonly cashFlowService: CashFlowService) {}

  @Post('forecasts')
  @RequirePermission('dashboards.read') // Adjust permission as needed, e.g. 'forecasts.write'
  async createForecast(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateCashFlowForecastDto,
    @CurrentUser('id') userId: string,
  ): Promise<CashFlowForecastResponseDto> {
    const forecast = await this.cashFlowService.createForecast(orgId, dto, userId);
    return forecast as CashFlowForecastResponseDto;
  }

  @Get('forecasts')
  @RequirePermission('dashboards.read')
  async findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('status') status?: 'pending' | 'realized' | 'cancelled',
  ): Promise<CashFlowForecastResponseDto[]> {
    const forecasts = await this.cashFlowService.findAllForOrganization(orgId, status);
    return forecasts as CashFlowForecastResponseDto[];
  }

  @Put('forecasts/:id')
  @RequirePermission('dashboards.read')
  async updateForecast(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCashFlowForecastDto,
  ): Promise<CashFlowForecastResponseDto> {
    const forecast = await this.cashFlowService.updateForecast(orgId, id, dto);
    return forecast as CashFlowForecastResponseDto;
  }

  @Delete('forecasts/:id')
  @RequirePermission('dashboards.read')
  async deleteForecast(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.cashFlowService.deleteForecast(orgId, id);
  }

  @Get('projection')
  @RequirePermission('dashboards.read')
  async getProjection(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('daysAhead') daysAhead?: string,
  ): Promise<CashFlowForecastReport> {
    const days = daysAhead ? parseInt(daysAhead, 10) : 90;
    return this.cashFlowService.getProjection(orgId, days);
  }
}
