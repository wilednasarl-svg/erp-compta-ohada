import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import { CreateBankAccountDto } from '../dto/create-bank-account.dto';
import { BankAccountEntity } from '../entities/bank-account.entity';
import { BankAccountsRepository } from '../repositories/bank-accounts.repository';

@Injectable()
export class BankAccountsService {
  private static readonly MODULE = 'bank-reconciliation' as const;
  private readonly logger = new Logger(BankAccountsService.name);

  constructor(
    private readonly accounts: BankAccountsRepository,
    private readonly chartAccounts: OrganizationAccountRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async listForOrg(organizationId: TenantId): Promise<BankAccountEntity[]> {
    assertTenantId(organizationId);
    return this.accounts.listByOrganization(organizationId);
  }

  async findById(id: string, organizationId: TenantId): Promise<BankAccountEntity> {
    assertTenantId(organizationId);
    const account = await this.accounts.findById(id, organizationId);
    if (!account) {
      throw new AppException(ERROR_CODES.BANK_ACCOUNT_NOT_FOUND, {
        message: `Bank account '${id}' not found.`,
      });
    }
    return account;
  }

  async create(
    organizationId: TenantId,
    dto: CreateBankAccountDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<BankAccountEntity> {
    assertTenantId(organizationId);

    const existing = await this.accounts.findByCode(organizationId, dto.code);
    if (existing) {
      throw new AppException(ERROR_CODES.BANK_ACCOUNT_CODE_TAKEN, {
        message: `Bank account code '${dto.code}' already exists in this organization.`,
      });
    }

    const chartAccount = await this.chartAccounts.findById(dto.chartAccountId, organizationId);
    if (!chartAccount) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: `Chart-of-accounts row '${dto.chartAccountId}' not found in this organization.`,
      });
    }

    const created = await this.accounts.create({
      organizationId,
      code: dto.code,
      label: dto.label,
      bankName: dto.bankName,
      accountNumber: dto.accountNumber ?? null,
      iban: dto.iban ?? null,
      currency: dto.currency ?? 'XOF',
      chartAccountId: dto.chartAccountId,
      openingBalance: dto.openingBalance ?? '0.00',
      status: dto.status ?? 'active',
      createdById: actorId,
    });

    await this.emitAudit(
      'bank_account_created',
      created.id,
      {
        code: created.code,
        label: created.label,
        bankName: created.bankName,
        chartAccountCode: chartAccount.code,
        currency: created.currency,
      },
      ctx,
      actorId,
      organizationId,
    );

    return created;
  }

  private async emitAudit(
    action: string,
    entityId: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
    actorId: string,
    organizationId: TenantId | string,
  ): Promise<void> {
    await this.audit
      .record({
        module: BankAccountsService.MODULE,
        action,
        entityType: 'bank_account',
        entityId,
        after: data,
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }
}
