import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { UpsertPayrollLineDto } from '../dto/upsert-payroll-line.dto';
import { GenerateSocialDto } from '../dto/generate-social.dto';
import {
  ListFiscalDeclarationsResponse,
  ListSocialPayrollLinesResponse,
  SocialPayrollLineEnvelopeResponse,
  SocialPeriodSummaryResponse,
} from '../dto/responses';
import {
  toListFiscalDeclarations,
  toListSocialPayrollLines,
  toSocialPayrollLineEnvelope,
  toSocialPeriodSummaryResponse,
} from '../mappers/fiscal-response.mapper';
import { SocialPayrollService } from '../services/social-payroll.service';

@ApiTags('Fiscal — Paie & charges sociales')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/fiscal/social-payroll')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class SocialPayrollController {
  constructor(private readonly social: SocialPayrollService) {}

  @Post('lines')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: SocialPayrollLineEnvelopeResponse })
  async upsertLine(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() dto: UpsertPayrollLineDto,
  ): Promise<SocialPayrollLineEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const line = await this.social.upsertLine(asTenantId(tokenOrgId), {
      periodYear: dto.periodYear,
      periodMonth: dto.periodMonth,
      employeeRef: dto.employeeRef,
      grossSalary: dto.grossSalary,
      createdById: userId ?? null,
    });
    return toSocialPayrollLineEnvelope(line);
  }

  @Get('lines')
  @RequirePermission('fiscal.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListSocialPayrollLinesResponse })
  async listLines(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('periodYear', ParseIntPipe) periodYear: number,
    @Query('periodMonth', ParseIntPipe) periodMonth: number,
  ): Promise<ListSocialPayrollLinesResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const lines = await this.social.listLines(asTenantId(tokenOrgId), periodYear, periodMonth);
    return toListSocialPayrollLines(lines);
  }

  @Delete('lines/:lineId')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deleteLine(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('lineId', new ParseUUIDPipe({ version: '4' })) lineId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<void> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    await this.social.deleteLine(lineId, asTenantId(tokenOrgId));
  }

  @Get('summary')
  @RequirePermission('fiscal.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SocialPeriodSummaryResponse })
  async summary(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('periodYear', ParseIntPipe) periodYear: number,
    @Query('periodMonth', ParseIntPipe) periodMonth: number,
  ): Promise<SocialPeriodSummaryResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const summary = await this.social.computeSummary(
      asTenantId(tokenOrgId),
      periodYear,
      periodMonth,
    );
    return toSocialPeriodSummaryResponse(summary);
  }

  @Post('generate-declarations')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ListFiscalDeclarationsResponse })
  async generate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() dto: GenerateSocialDto,
  ): Promise<ListFiscalDeclarationsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const decls = await this.social.generateDeclarations(
      asTenantId(tokenOrgId),
      dto.periodYear,
      dto.periodMonth,
      userId ?? null,
    );
    return toListFiscalDeclarations(decls, decls.length);
  }

  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: string | undefined,
  ): asserts tokenOrgId is string {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, { message: 'Organization not found' });
    }
  }
}
