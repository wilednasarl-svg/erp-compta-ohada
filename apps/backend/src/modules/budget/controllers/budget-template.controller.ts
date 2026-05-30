import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

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
import { BudgetImportReportResponse } from '../dto/responses';
import { BudgetImportService } from '../services/budget-import.service';
import { BudgetLinesService } from '../services/budget-lines.service';
import { BudgetTemplateService } from '../services/budget-template.service';
import type { BudgetScenario, BudgetType } from '../types/budget.types';

interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_MAX_ROWS = 50_000;

@ApiTags('Budget — Import / Export')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/budget')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BudgetTemplateController {
  constructor(
    private readonly template: BudgetTemplateService,
    private readonly importer: BudgetImportService,
    private readonly lines: BudgetLinesService,
  ) {}

  @Get('template.xlsx')
  @RequirePermission('budget.read')
  downloadTemplate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Res() res: Response,
  ): void {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const buffer = this.template.buildTemplate();
    this.sendFile(res, buffer, 'template-budget.xlsx');
  }

  @Get('export.xlsx')
  @RequirePermission('budget.read')
  async exportLines(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Res() res: Response,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('scenario') scenario?: BudgetScenario,
    @Query('budgetType') budgetType?: BudgetType,
  ): Promise<void> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const orgId = asTenantId(tokenOrgId);
    const { rows } = await this.lines.list(orgId, {
      fiscalYear: fiscalYear ? Number(fiscalYear) : undefined,
      scenario,
      budgetType,
      limit: EXPORT_MAX_ROWS,
    });
    const buffer = await this.template.exportLines(orgId, rows);
    this.sendFile(res, buffer, `budget-${fiscalYear ?? 'all'}.xlsx`);
  }

  @Post('import')
  @RequirePermission('budget.write')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({ type: BudgetImportReportResponse })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize:
          (Number.parseInt(process.env.IMPORT_MAX_FILE_SIZE_MB ?? '50', 10) + 1) * 1024 * 1024,
      },
    }),
  )
  async importLines(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ): Promise<BudgetImportReportResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    if (!file) {
      throw new AppException(ERROR_CODES.BUDGET_IMPORT_INVALID_FORMAT, {
        message: 'Un fichier est requis dans le champ multipart "file"',
      });
    }
    const report = await this.importer.parseAndImport(
      asTenantId(tokenOrgId),
      file.buffer,
      userId ?? null,
    );
    return report;
  }

  private sendFile(res: Response, buffer: Buffer, downloadName: string): void {
    res
      .set({
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-store',
      })
      .end(buffer);
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
