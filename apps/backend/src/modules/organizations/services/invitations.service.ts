import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { CLOCK, type Clock } from '../../../common/time/clock';
import type { AuthEventContext } from '../../audit/services/auth-events.service';
import { AuthEventsService } from '../../audit/services/auth-events.service';
import { JwtTokenService } from '../../auth/services/jwt-token.service';
import { PasswordService } from '../../auth/services/password.service';
import { UserRepository } from '../../auth/repositories/user.repository';
import { EmailService } from '../../email/services/email.service';
import { MembershipRepository } from '../../rbac/repositories/membership.repository';
import { RoleRepository } from '../../rbac/repositories/role.repository';
import { OrganizationRepository } from '../repositories/organization.repository';
import { InvitationRepository } from '../repositories/invitation.repository';
import type { InvitationEntity } from '../entities/invitation.entity';
import type { MembershipEntity } from '../../rbac/entities/membership.entity';
import type { UserEntity } from '../../auth/entities/user.entity';

const PASSWORD_MIN_LENGTH = 12;
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InvitationView {
  readonly id: string;
  readonly email: string;
  readonly roleCode: string;
  readonly status: InvitationEntity['status'];
  readonly expiresAt: Date;
  readonly invitedBy: string;
}

export interface CreateInvitationInput {
  readonly email: string;
  readonly roleCode: string;
}

export interface CreateInvitationResult {
  readonly invitation: InvitationView;
}

export interface AcceptInvitationInput {
  readonly token: string;
  readonly password?: string;
  readonly firstName?: string;
  readonly lastName?: string;
}

export interface AcceptInvitationResult {
  readonly user: { id: string; email: string };
  readonly organization: { id: string; name: string; slug: string };
  readonly membership: { id: string; role: string };
  /**
   * `true` when the accept path created the user account on the fly
   * (signup branch). Lets the controller switch its HTTP status (201 vs
   * 200) without duplicating the user-existence check at the controller
   * layer.
   */
  readonly userCreated: boolean;
}

/**
 * `InvitationsService` (BE-INV-01..03) — orchestrates the three admin /
 * invitee flows defined in `specs/organizations/spec.md`:
 *
 *   - `create`  (BE-INV-01) — admin issues an invitation. Signs a JWT
 *                              carrying `{ org_id, email, role_id,
 *                              invitation_id }` valid for 7 days. The
 *                              hash of the JWT is stored in
 *                              `invitations.token_hash`; the plaintext
 *                              only ever leaves through the outgoing
 *                              email. Duplicate `pending` invitation for
 *                              the same `(org, email)` → 409
 *                              `INVITATION_ALREADY_PENDING`.
 *   - `accept`  (BE-INV-02) — public, token-gated. Verifies the JWT
 *                              (expired → 410, malformed → 404),
 *                              re-checks the DB row (revoked → 409,
 *                              already-used → 409). Email-matched user
 *                              → just creates the membership. Email
 *                              unknown → requires signup fields, creates
 *                              the user (argon2id) + membership in one
 *                              shot. Emits `organizations.invitation_accepted`
 *                              and (on signup branch) `auth.signup`.
 *   - `revoke`  (BE-INV-03) — admin marks a `pending` row `revoked`.
 *                              Idempotent on already-final rows (no-op
 *                              for `accepted` / `expired` / `revoked`).
 *
 * Tenant invariant: `InvitationRepository` requires `organizationId` on
 * every method (via `TenantId` brand + `assertTenantId`). The controller
 * derives the org id from `TenantGuard` → `currentOrg.id`; this service
 * never accepts an `organizationId` from the URL/body that hasn't been
 * vetted by the guard pipeline.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly invitations: InvitationRepository,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtTokenService,
    private readonly audit: AuthEventsService,
    private readonly email: EmailService,
  ) {}

  async create(
    inviterUserId: string,
    organizationId: string,
    input: CreateInvitationInput,
    context: AuthEventContext,
  ): Promise<CreateInvitationResult> {
    const [organization, role] = await Promise.all([
      this.organizations.findActiveById(organizationId),
      this.roles.findByCode(input.roleCode),
    ]);
    if (organization === null) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, { message: 'Organization not found' });
    }
    if (role === null) {
      throw new AppException(ERROR_CODES.INVITATION_NOT_FOUND, {
        message: `Unknown role code "${input.roleCode}"`,
      });
    }

    const duplicate = await this.invitations.findPendingByEmail(input.email, organizationId);
    if (duplicate !== null) {
      throw new AppException(ERROR_CODES.INVITATION_ALREADY_PENDING, {
        message: 'A pending invitation already exists for this email',
        details: { invitationId: duplicate.id },
      });
    }

    const expiresAt = new Date(this.clock.nowMs() + INVITATION_TTL_MS);
    // Two-step persist: insert the row first so we get a stable
    // `invitation_id` for the JWT `sub`/`invitation_id` claims, then
    // patch with the real `token_hash` once we've signed.
    const placeholderHash = this.hashToken(`pending-${this.clock.nowMs()}`);
    const persisted = await this.invitations.create(organizationId, {
      email: input.email,
      roleId: role.id,
      tokenHash: placeholderHash,
      invitedBy: inviterUserId,
      expiresAt,
    });

    const token = this.jwt.signInvitationToken({
      sub: inviterUserId,
      invitationId: persisted.id,
      orgId: organizationId,
      email: input.email,
      roleId: role.id,
    });
    const tokenHash = this.hashToken(token);
    await this.invitations.updateTokenHash(persisted.id, organizationId, tokenHash);

    const acceptUrl = this.email.buildAcceptInvitationUrl(token);
    await this.email.sendInvitationEmail({
      to: input.email,
      organizationName: organization.name,
      inviterName: await this.resolveInviterDisplayName(inviterUserId),
      roleCode: role.code,
      acceptUrl,
    });

    await this.audit.record(
      'organizations.invitation_sent',
      {
        ...context,
        userId: inviterUserId,
        organizationId,
      },
      { invitationId: persisted.id, email: input.email, roleCode: role.code },
    );

    return {
      invitation: {
        id: persisted.id,
        email: persisted.email,
        roleCode: role.code,
        status: 'pending',
        expiresAt,
        invitedBy: inviterUserId,
      },
    };
  }

  async listPending(organizationId: string): Promise<ReadonlyArray<InvitationView>> {
    const rows = await this.invitations.listByStatus(organizationId, 'pending');
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async revoke(
    callerUserId: string,
    organizationId: string,
    invitationId: string,
    context: AuthEventContext,
  ): Promise<void> {
    const invitation = await this.invitations.findById(invitationId, organizationId);
    if (invitation === null) {
      throw new AppException(ERROR_CODES.INVITATION_NOT_FOUND, {
        message: 'Invitation not found',
      });
    }
    if (invitation.status !== 'pending') {
      // Idempotent on already-final rows: no DB write, no audit row.
      // Returning a non-error keeps the admin UI simple ("Revoke" can be
      // clicked twice without surprise) while still being a no-op for
      // already-accepted invitations (which can't be un-accepted).
      return;
    }
    await this.invitations.markRevoked(invitationId, organizationId);
    await this.audit.record(
      'organizations.invitation_sent',
      {
        ...context,
        userId: callerUserId,
        organizationId,
      },
      { invitationId, action: 'revoked' },
    );
  }

  async accept(
    input: AcceptInvitationInput,
    context: AuthEventContext,
  ): Promise<AcceptInvitationResult> {
    const claims = this.jwt.verifyInvitationToken(input.token);

    const presentedHash = this.hashToken(input.token);
    const invitation = await this.invitations.findById(claims.invitation_id, claims.org_id);
    if (invitation === null || invitation.tokenHash !== presentedHash) {
      throw new AppException(ERROR_CODES.INVITATION_NOT_FOUND, {
        message: 'Invitation not found',
      });
    }
    if (invitation.status === 'accepted') {
      throw new AppException(ERROR_CODES.INVITATION_ALREADY_USED, {
        message: 'Invitation has already been used',
      });
    }
    if (invitation.status === 'revoked') {
      throw new AppException(ERROR_CODES.INVITATION_REVOKED, {
        message: 'Invitation has been revoked',
      });
    }
    if (invitation.status === 'expired') {
      throw new AppException(ERROR_CODES.INVITATION_EXPIRED, { message: 'Invitation expired' });
    }
    if (invitation.expiresAt.getTime() <= this.clock.nowMs()) {
      await this.invitations.markExpired(invitation.id, claims.org_id);
      throw new AppException(ERROR_CODES.INVITATION_EXPIRED, { message: 'Invitation expired' });
    }

    const [organization, role] = await Promise.all([
      this.organizations.findActiveById(claims.org_id),
      this.roles.findById(claims.role_id),
    ]);
    if (organization === null || role === null) {
      throw new AppException(ERROR_CODES.INVITATION_NOT_FOUND, {
        message: 'Invitation no longer addressable',
      });
    }

    const existing = await this.users.findActiveByEmail(claims.email);
    let user: UserEntity;
    let userCreated = false;
    if (existing !== null) {
      user = existing;
    } else {
      if (typeof input.password !== 'string' || input.password.length < PASSWORD_MIN_LENGTH) {
        throw new AppException(ERROR_CODES.AUTH_WEAK_PASSWORD, {
          message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
          details: { field: 'password', minLength: PASSWORD_MIN_LENGTH },
        });
      }
      const passwordHash = await this.passwords.hashPassword(input.password);
      user = await this.users.create({
        email: claims.email,
        passwordHash,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
      });
      userCreated = true;
      await this.audit.record(
        'auth.signup',
        {
          ...context,
          userId: user.id,
          organizationId: claims.org_id,
        },
        { email: claims.email, viaInvitation: invitation.id },
      );
    }

    // The user may already have a membership in this org (edge case: an
    // admin invites a user who was already added via another path). Skip
    // re-creating, surface a clean error.
    const existingMembership = await this.memberships.findByUserAndOrganization(
      user.id,
      claims.org_id,
    );
    let membership: MembershipEntity;
    if (existingMembership !== null) {
      throw new AppException(ERROR_CODES.INVITATION_ALREADY_USED, {
        message: 'User is already a member of this organization',
      });
    } else {
      membership = await this.memberships.create({
        userId: user.id,
        organizationId: claims.org_id,
        roleId: claims.role_id,
        status: 'active',
      });
    }

    await this.invitations.markAccepted(invitation.id, claims.org_id, this.clock.now());

    await this.audit.record(
      'organizations.invitation_accepted',
      {
        ...context,
        userId: user.id,
        organizationId: claims.org_id,
      },
      { invitationId: invitation.id, role: role.code },
    );

    return {
      user: { id: user.id, email: user.email },
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      membership: { id: membership.id, role: role.code },
      userCreated,
    };
  }

  private async resolveInviterDisplayName(userId: string): Promise<string | null> {
    const inviter = await this.users.findActiveById(userId);
    if (inviter === null) {
      return null;
    }
    const parts = [inviter.firstName, inviter.lastName].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (parts.length > 0) {
      return parts.join(' ');
    }
    return inviter.email;
  }

  private async toView(row: InvitationEntity): Promise<InvitationView> {
    const role = await this.roles.findById(row.roleId);
    return {
      id: row.id,
      email: row.email,
      roleCode: role?.code ?? 'unknown',
      status: row.status,
      expiresAt: row.expiresAt,
      invitedBy: row.invitedBy,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
