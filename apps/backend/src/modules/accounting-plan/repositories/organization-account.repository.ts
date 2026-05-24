import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationAccountEntity } from '../entities/organization-account.entity';

/**
 * `OrganizationAccountRepository` (BE-PC-04) — tenant-scoped CRUD on
 * the organisation chart of accounts.
 *
 * Every method that touches a row takes `organizationId: TenantId | string`
 * and runs `assertTenantId` first. The `TenantId` brand makes a missing
 * scope a compile-time error; runtime guard catches empty values. Every
 * query in this file filters on `organization_id` — cross-tenant
 * exposure here would break the multi-tenant contract enforced by the
 * `TenantGuard` upstream.
 */
@Injectable()
export class OrganizationAccountRepository {
  constructor(
    @InjectRepository(OrganizationAccountEntity)
    private readonly repo: Repository<OrganizationAccountEntity>,
  ) {}

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<OrganizationAccountEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findByCode(
    code: string,
    organizationId: TenantId | string,
  ): Promise<OrganizationAccountEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { code, organizationId } });
  }

  /**
   * Full chart for the org, ordered by code so the consumer can render
   * an arborescence without an extra sort. Optional `activeOnly` filter
   * for the dashboards that hide deactivated accounts.
   */
  async listByOrganization(
    organizationId: TenantId | string,
    options: { activeOnly?: boolean; classFilter?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 } = {},
  ): Promise<OrganizationAccountEntity[]> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { organizationId };
    if (options.activeOnly === true) {
      where['isActive'] = true;
    }
    if (options.classFilter !== undefined) {
      where['class'] = options.classFilter;
    }
    return this.repo.find({ where, order: { code: 'ASC' } });
  }

  async countChildren(
    parentId: string,
    organizationId: TenantId | string,
    options: { activeOnly?: boolean } = {},
  ): Promise<number> {
    assertTenantId(organizationId);
    const where: Record<string, unknown> = { parentId, organizationId };
    if (options.activeOnly === true) {
      where['isActive'] = true;
    }
    return this.repo.count({ where });
  }

  /**
   * `true` when at least one STRICT DESCENDANT of `codePrefix` already
   * exists in the org's chart. "Strict" = at least one extra digit after
   * the prefix — the prefix itself doesn't satisfy the predicate. Used
   * by `ChartOfAccountsService.createCustomAccount` to check whether a
   * parent already has children (which would force the `POSTING → TITLE`
   * promotion).
   *
   * Wildcard handling: `%`, `_`, and `\` in the input are escaped with
   * `ESCAPE '\\'` before being passed to LIKE. OHADA codes are numeric
   * only and would never legitimately contain wildcards, but escaping
   * is a cheap safety net for the day a non-numeric identifier (e.g.
   * analytical sub-account) is added to the schema.
   */
  async existsAnyByCodePrefix(
    codePrefix: string,
    organizationId: TenantId | string,
  ): Promise<boolean> {
    assertTenantId(organizationId);
    const escaped = codePrefix.replace(/[\\%_]/g, '\\$&');
    const count = await this.repo
      .createQueryBuilder('a')
      .where('a.organization_id = :organizationId', { organizationId })
      // `_` after the escaped prefix forces at least one extra char —
      // i.e. strict descendant. `_%` then allows zero or more further
      // chars. ESCAPE '\\' tells Postgres that `\%` and `\_` in our
      // pattern are literal characters, not wildcards.
      .andWhere("a.code LIKE :prefix ESCAPE '\\'", { prefix: `${escaped}_%` })
      .getCount();
    return count > 0;
  }

  async create(input: {
    organizationId: TenantId | string;
    code: string;
    label: string;
    class: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    accountType: 'TITLE' | 'POSTING';
    normalBalance: 'D' | 'C';
    parentId: string | null;
    referenceAccountId: string | null;
    isActive?: boolean;
  }): Promise<OrganizationAccountEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      code: input.code,
      label: input.label,
      class: input.class,
      accountType: input.accountType,
      normalBalance: input.normalBalance,
      parentId: input.parentId,
      referenceAccountId: input.referenceAccountId,
      isActive: input.isActive ?? true,
    });
    return this.repo.save(entity);
  }

  async updateLabelAndActive(
    id: string,
    organizationId: TenantId | string,
    patch: { label?: string; isActive?: boolean },
  ): Promise<void> {
    assertTenantId(organizationId);
    const set: Record<string, unknown> = {};
    if (patch.label !== undefined) {
      set['label'] = patch.label;
    }
    if (patch.isActive !== undefined) {
      set['isActive'] = patch.isActive;
    }
    if (Object.keys(set).length === 0) {
      return;
    }
    await this.repo.update({ id, organizationId }, set);
  }

  /**
   * Promote a TITLE → POSTING (rare) or POSTING → TITLE flip — used by
   * `ChartOfAccountsService.createCustomAccount` when adding the first
   * child under a POSTING account (its account_type must become TITLE
   * since it now has descendants; only leaves can be posted to).
   */
  async setAccountType(
    id: string,
    organizationId: TenantId | string,
    accountType: 'TITLE' | 'POSTING',
  ): Promise<void> {
    assertTenantId(organizationId);
    await this.repo.update({ id, organizationId }, { accountType });
  }

  async deleteCustom(id: string, organizationId: TenantId | string): Promise<number> {
    assertTenantId(organizationId);
    // Only allow deletion of CUSTOM accounts (reference_account_id IS NULL)
    // via a guarded DELETE — the service layer also checks this, but the
    // SQL safety net prevents an accidental call path from removing a
    // reference-backed row. Returns the number of affected rows so the
    // service can map 0 → CHART_ACCOUNT_NOT_DELETABLE.
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .from(OrganizationAccountEntity)
      .where('id = :id', { id })
      .andWhere('organization_id = :organizationId', { organizationId })
      .andWhere('reference_account_id IS NULL')
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Count custom (non-referenced) accounts in the org. Lets the seed /
   * dev tools tell when an org's chart has been customised vs still
   * pure SYSCOHADA.
   */
  async countCustom(organizationId: TenantId | string): Promise<number> {
    assertTenantId(organizationId);
    return this.repo.count({ where: { organizationId, referenceAccountId: IsNull() } });
  }
}
