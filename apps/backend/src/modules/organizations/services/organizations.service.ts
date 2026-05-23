import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { AuthEventContext } from '../../audit/services/auth-events.service';
import { AuthEventsService } from '../../audit/services/auth-events.service';
import type { MembershipEntity } from '../../rbac/entities/membership.entity';
import { MembershipRepository } from '../../rbac/repositories/membership.repository';
import { RoleRepository } from '../../rbac/repositories/role.repository';
import type { OrganizationEntity, OrganizationType } from '../entities/organization.entity';
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
}

export interface CreateOrganizationResult {
  readonly organization: OrganizationEntity;
  readonly membership: MembershipEntity;
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
  ) {}

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

    const organization = await this.organizations.create({
      name: input.name,
      slug,
      type: input.type,
    });

    const membership = await this.memberships.create({
      userId: creatorUserId,
      organizationId: organization.id,
      roleId: adminRole.id,
      status: 'active',
    });

    await this.audit.record(
      'organizations.updated',
      {
        ...context,
        userId: creatorUserId,
        organizationId: organization.id,
      },
      {
        action: 'created',
        organizationId: organization.id,
        slug: organization.slug,
        type: organization.type,
      },
    );

    return { organization, membership };
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
