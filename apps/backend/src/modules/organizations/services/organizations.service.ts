import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { OrganizationAccountingConfigEntity } from '../../accounting-plan/entities/organization-accounting-config.entity';
import { ChartOfAccountsService } from '../../accounting-plan/services/chart-of-accounts.service';
import type { AccountingSystem } from '../../accounting-plan/types/accounting-system';
import type { AuthEventContext } from '../../audit/services/auth-events.service';
import { AuthEventsService } from '../../audit/services/auth-events.service';
import { MembershipEntity } from '../../rbac/entities/membership.entity';
import { MembershipRepository } from '../../rbac/repositories/membership.repository';
import { RoleRepository } from '../../rbac/repositories/role.repository';
import { OrganizationEntity, type OrganizationType } from '../entities/organization.entity';
import { OrganizationRepository } from '../repositories/organization.repository';
import { buildSlugWithSuffix, slugify } from '../lib/slug';

/**
 * Maximum number of `-N` suffixes we'll try when deriving a unique slug.
 * A realistic accounting-firm namespace will collide in single digits;
 * a quattuor-mille cap exists purely to bound the worst case (e.g. a
 * brute-force attempt to enumerate via slug squatting). When exhausted
 * we throw an `INTERNAL_ERROR` rather than spinning forever.
 */
const MAX_SLUG_COLLISION_RETRIES = 9999;

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: string;
}

export interface CreateOrganizationInput {
  readonly name: string;
  readonly type: OrganizationType;
  readonly system: AccountingSystem;
}

export interface CreateOrganizationResult {
  readonly organization: OrganizationEntity;
  readonly membership: MembershipEntity;
  readonly system: AccountingSystem;
}

export interface UpdateOrganizationInput {
  readonly name?: string;
}

/**
 * `OrganizationsService` (BE-ORG-01..03) — orchestration for the three
 * MVP organization endpoints:
 *
 *   - `create`               — derives a unique slug, persists the org,
 *                              auto-creates the creator's `admin`
 *                              membership, and journals
 *                              `organizations.updated` (no dedicated
 *                              `organizations.created` event in the
 *                              spec; the journal is keyed by the org
 *                              row's existence).
 *   - `listForUser`          — translates `MembershipRepository
 *                              .listOrganizationsForUser` into the
 *                              public summary shape `{ id, name, slug,
 *                              role }`.
 *   - `update`               — admin-only rename. `slug` is intentionally
 *                              immutable (spec scenario "Slug change is
 *                              rejected"). The admin-only invariant is
 *                              enforced upstream by
 *                              `@Roles('admin')` + `RolesGuard`; this
 *                              service only enforces the URL-vs-token
 *                              org-id match to fail closed on the rare
 *                              edge case of a route bypassed by an
 *                              upstream guard misconfiguration.
 *
 * Multi-tenant invariant: the `admin` role lookup at `create` time is a
 * single round-trip (catalog read by code, not tenant-scoped). All
 * subsequent membership / organization reads on `update` are scoped to
 * the org id resolved from `TenantGuard`.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleRepository,
    private readonly audit: AuthEventsService,
    private readonly chartOfAccounts: ChartOfAccountsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Atomic org creation (BE-ORG-01 + BE-PC-08). Persists in a single
   * transaction:
   *   1. the `organizations` row,
   *   2. the creator's admin `memberships` row,
   *   3. the `organization_accounting_configs` row (system locked),
   *   4. the clone of the SYSCOHADA reference plan into
   *      `organization_chart_accounts` (joins the same txn via
   *      `cloneReferenceIntoOrganization(orgId, system, manager)`).
   *
   * If any of the four fails the transaction is rolled back — no
   * half-provisioned organisation exists. Audit events are emitted
   * AFTER commit so we never journal a rolled-back insert (the
   * journal is observability, not part of the consistency boundary).
   *
   * Slug derivation runs BEFORE the transaction (cheap reads, can
   * tolerate the brief race window the existing comment documents on
   * `deriveAvailableSlug`).
   */
  async create(
    creatorUserId: string,
    input: CreateOrganizationInput,
    context: AuthEventContext,
  ): Promise<CreateOrganizationResult> {
    const adminRole = await this.roles.findByCode('admin');
    if (adminRole === null) {
      // Migration 0003 seeds the role; absence indicates a broken install.
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'System role "admin" is not seeded',
      });
    }

    const slug = await this.deriveAvailableSlug(input.name);

    const { organization, membership, cloneResult } = await this.dataSource.transaction(
      async (manager) => {
        // We bypass the per-entity repositories here and go through
        // `manager.getRepository(...)` so every write joins the same
        // physical transaction. The existing repos remain authoritative
        // for everything outside of org creation; this is the one place
        // where transactional atomicity across modules outweighs the
        // benefit of routing through them.
        const orgRepo = manager.getRepository(OrganizationEntity);
        const persistedOrg = await orgRepo.save(
          orgRepo.create({ name: input.name, slug, type: input.type }),
        );

        const membershipRepo = manager.getRepository(MembershipEntity);
        const persistedMembership = await membershipRepo.save(
          membershipRepo.create({
            userId: creatorUserId,
            organizationId: persistedOrg.id,
            roleId: adminRole.id,
            status: 'active',
          }),
        );

        const configRepo = manager.getRepository(OrganizationAccountingConfigEntity);
        await configRepo.save(
          configRepo.create({
            organizationId: persistedOrg.id,
            system: input.system,
          }),
        );

        const clone = await this.chartOfAccounts.cloneReferenceIntoOrganization(
          persistedOrg.id,
          input.system,
          manager,
        );

        return { organization: persistedOrg, membership: persistedMembership, cloneResult: clone };
      },
    );

    // Audit events — emitted post-commit so a rolled-back transaction
    // leaves no trace in the journal. `AuthEventsService.record` is
    // swallow-and-warn, so a flaky audit table cannot break creation.
    await this.audit.record(
      'organizations.updated',
      { ...context, userId: creatorUserId, organizationId: organization.id },
      {
        action: 'created',
        organizationId: organization.id,
        slug: organization.slug,
        type: organization.type,
        system: input.system,
      },
    );
    await this.audit.record(
      'chart_of_accounts.imported',
      { ...context, userId: creatorUserId, organizationId: organization.id },
      { system: input.system, accountCount: cloneResult.added },
    );

    return { organization, membership, system: input.system };
  }

  async listForUser(userId: string): Promise<ReadonlyArray<OrganizationSummary>> {
    const rows = await this.memberships.listOrganizationsForUser(userId);
    const summaries: OrganizationSummary[] = [];
    for (const row of rows) {
      // `listOrganizationsForUser` loads both relations; rows where the
      // org row has been soft-deleted are skipped — the user belongs but
      // the tenant is no longer addressable.
      if (
        row.organization === undefined ||
        row.role === undefined ||
        row.organization.deletedAt !== null
      ) {
        continue;
      }
      summaries.push({
        id: row.organization.id,
        name: row.organization.name,
        slug: row.organization.slug,
        role: row.role.code,
      });
    }
    return summaries;
  }

  async update(
    callerUserId: string,
    targetOrgId: string,
    tokenOrgId: string,
    input: UpdateOrganizationInput,
    context: AuthEventContext,
  ): Promise<{ organization: OrganizationEntity }> {
    // Fail-closed on URL/token mismatch even though TenantGuard already
    // enforces the membership check on tokenOrgId. Returning 404 (not
    // 403) matches the spec's "no information disclosure" policy.
    if (targetOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }

    if (input.name === undefined) {
      // Spec scenario "Slug change is rejected" — a request whose only
      // mutable field was `slug` (silently dropped by the DTO whitelist)
      // arrives here as an empty input. 422 keeps the response shape
      // consistent with other validation failures.
      throw new AppException(ERROR_CODES.ORG_NOTHING_TO_UPDATE, {
        message: 'No mutable field provided',
      });
    }

    const updated = await this.organizations.updateName(targetOrgId, input.name);
    if (updated === null) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }

    await this.audit.record(
      'organizations.updated',
      {
        ...context,
        userId: callerUserId,
        organizationId: updated.id,
      },
      { action: 'updated', fields: ['name'] },
    );

    return { organization: updated };
  }

  /**
   * Derive a unique slug from `name`. First tries the bare slugified
   * form; on collision, appends `-2`, `-3`, … until the repository
   * reports no row with that slug. Bounded by
   * `MAX_SLUG_COLLISION_RETRIES` so a pathological adversarial namespace
   * can't loop forever.
   *
   * Race note: between the `slugExists` check and the eventual `INSERT`
   * a concurrent transaction could grab the same slug. The DB UNIQUE
   * constraint on `organizations.slug` is the ultimate guard — a 23505
   * would surface as a 500 here, which is acceptable at MVP given the
   * extremely low concurrency on org creation. A later hardening pass
   * can wrap the insert in `ON CONFLICT (slug) DO NOTHING RETURNING *`
   * and retry the suffix loop.
   */
  private async deriveAvailableSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let suffix = 1; suffix <= MAX_SLUG_COLLISION_RETRIES; suffix += 1) {
      const candidate = buildSlugWithSuffix(base, suffix);
      const exists = await this.organizations.slugExists(candidate);
      if (!exists) {
        return candidate;
      }
    }
    throw new Error(
      `OrganizationsService.deriveAvailableSlug: exhausted ${MAX_SLUG_COLLISION_RETRIES} retries for base "${base}"`,
    );
  }
}
