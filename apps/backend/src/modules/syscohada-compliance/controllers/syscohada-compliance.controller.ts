import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { ComplianceQueryDto } from '../dto/compliance-query.dto';
import {
  SyscohadaComplianceService,
  type SyscohadaComplianceReport,
} from '../services/syscohada-compliance.service';

/**
 * `SyscohadaComplianceController` — expose le rapport de conformité SYSCOHADA
 * exécuté sur les données comptables réelles de l'organisation (lecture seule).
 *
 * Contrairement aux endpoints `/<module>/syscohada-guidance` qui servent de la
 * doctrine publique, celui-ci lit des données tenant : il est donc protégé par
 * `JwtAuthGuard + TenantGuard + PermissionsGuard` et réutilise la permission
 * `journals.reports` (même périmètre de lecture que les états financiers).
 */
@ApiTags('SYSCOHADA Compliance')
@ApiBearerAuth()
@Controller('organizations/:id/syscohada-compliance')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class SyscohadaComplianceController {
  constructor(private readonly compliance: SyscohadaComplianceService) {}

  @Get()
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Évalue les contrôles SYSCOHADA bloquants sur les données réelles (bilan, écritures) et rattache chaque verdict à sa base doctrinale sourcée.',
  })
  @ApiOkResponse({ description: 'Rapport de conformité structuré (verdict, comptes, résultats).' })
  async evaluate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: ComplianceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: SyscohadaComplianceReport }> {
    const report = await this.compliance.evaluate(asTenantId(org.id), {
      fiscalYearStartDate: query.fiscalYearStartDate,
      asAtDate: query.asAtDate,
    });
    return { report };
  }
}
