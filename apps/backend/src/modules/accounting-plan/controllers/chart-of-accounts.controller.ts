import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { OrganizationAccountingConfigRepository } from '../repositories/organization-accounting-config.repository';
import { ChartOfAccountsService, type AccountView } from '../services/chart-of-accounts.service';
import { CreateAccountDto } from '../dto/create-account.dto';
import { UpdateAccountDto } from '../dto/update-account.dto';

/**
 * `ChartOfAccountsController` (BE-PC-07.2) — tenant-scoped CRUD on the
 * organisation chart of accounts, mounted under
 * `/organizations/:id/chart-of-accounts`.
 *
 *   GET    /                  — read (chart_of_accounts.read)
 *   GET    /:accountId        — read single (chart_of_accounts.read)
 *   POST   /                  — create custom sub-account (chart_of_accounts.write)
 *   PATCH  /:accountId        — update label/active (chart_of_accounts.write)
 *   DELETE /:accountId        — delete custom leaf (chart_of_accounts.write)
 *   POST   /import            — idempotent re-clone from reference (chart_of_accounts.write)
 *
 * The TenantGuard binds `currentOrg` from the JWT claim; the path-level
 * `:id` is compared in `assertOrgMatch` as defence-in-depth against a
 * route accidentally exposed without the guard. Mismatch surfaces as
 * `404 ORG_NOT_FOUND` (never 403) to keep with the spec's
 * "no info disclosure" policy.
 */
@ApiTags('ChartOfAccounts')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/chart-of-accounts')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ChartOfAccountsController {
  constructor(
    private readonly chart: ChartOfAccountsService,
    private readonly configs: OrganizationAccountingConfigRepository,
  ) {}

  @Get()
  @RequirePermission('chart_of_accounts.read')
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ accounts: ReadonlyArray<AccountView> }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const accounts = await this.chart.listForOrganization(tokenOrgId);
    return { accounts };
  }

  @Get(':accountId')
  @RequirePermission('chart_of_accounts.read')
  @HttpCode(HttpStatus.OK)
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ account: AccountView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const account = await this.chart.getAccount(tokenOrgId, accountId);
    return { account };
  }

  @Post()
  @RequirePermission('chart_of_accounts.write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateAccountDto,
    @Req() req: Request,
  ): Promise<{ account: AccountView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const account = await this.chart.createCustomAccount(
      tokenOrgId,
      { parentCode: body.parentCode, code: body.code, label: body.label },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { account };
  }

  @Patch(':accountId')
  @RequirePermission('chart_of_accounts.write')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: UpdateAccountDto,
    @Req() req: Request,
  ): Promise<{ account: AccountView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const account = await this.chart.updateAccount(
      tokenOrgId,
      accountId,
      // `code` is not whitelisted by `UpdateAccountDto`, so the
      // ValidationPipe strips it before we get here; pass through the
      // two mutable fields only.
      { label: body.label, isActive: body.isActive },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { account };
  }

  @Delete(':accountId')
  @RequirePermission('chart_of_accounts.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<void> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    await this.chart.deleteAccount(
      tokenOrgId,
      accountId,
      actorUserId,
      buildAuditRequestContext(req),
    );
  }

  /**
   * Idempotent re-clone of the SYSCOHADA reference into the org's
   * chart. Useful for:
   *   - the degraded recovery path (an org created before the wizard
   *     extension that lacks a populated chart),
   *   - the dev seed (`pnpm seed:fix-accounting-configs`).
   *
   * The org's locked accounting system (`organization_accounting_configs.system`)
   * is the source of truth — the request body is empty, no field can
   * override that choice.
   */
  @Post('import')
  @RequirePermission('chart_of_accounts.write')
  @HttpCode(HttpStatus.OK)
  async import(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ added: number; skipped: number }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const config = await this.configs.findByOrganizationId(tokenOrgId);
    if (config === null) {
      // No accounting config row → the wizard step never ran or the
      // org was created before the Module 2 integration landed.
      // Surface this as 404 (the same code as a missing org from the
      // caller's perspective — they should not be able to distinguish
      // a missing org from a half-provisioned one).
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization has no accounting configuration',
      });
    }
    return this.chart.cloneReferenceIntoOrganization(tokenOrgId, config.system);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: string | undefined,
  ): asserts tokenOrgId is string {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }
  }

  private assertActor(actorUserId: string | undefined): asserts actorUserId is string {
    if (actorUserId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
  }
}
