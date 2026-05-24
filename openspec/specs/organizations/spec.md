# organizations Specification

## Purpose
Racine d'isolation multi-tenant de la plateforme. Définit l'entité `Organization` (cabinet OHADA ou PME), le lien `Membership` (User ↔ Organization avec rôle), et le cycle de vie des invitations email (token JWT 7 jours, hash stocké, usage unique). Tout module métier ultérieur (comptabilité, états de synthèse, audit trail) opère DANS le périmètre d'une organisation et passe par le `TenantGuard` pour isoler les données.
## Requirements
### Requirement: Organization creation

The system SHALL allow an authenticated user to create a new organization via `POST /organizations`. The creator SHALL automatically become a member of the new organization with the `admin` role. Each organization MUST have a globally unique `slug` derived from its name (lowercased, kebab-case, deduplicated with a numeric suffix on collision).

#### Scenario: Create a new organization
- **WHEN** an authenticated user calls `POST /organizations` with `{ name: "Cabinet Konan & Associés", type: "firm" }`
- **THEN** the system creates a row in `organizations` with a unique slug, creates a `memberships` row linking the user to the org with `role = admin`, and returns `201` with `{ data: { organization, membership } }`

#### Scenario: Slug collision
- **WHEN** an organization with `slug = "cabinet-konan"` already exists and a new org is created with the same name
- **THEN** the system assigns slug `cabinet-konan-2` (or next available suffix) and the creation still succeeds

### Requirement: List organizations the current user belongs to

The system SHALL expose `GET /organizations` which returns only the organizations where the authenticated user has an active `membership`. Suspended or deleted memberships MUST NOT appear.

#### Scenario: User lists their organizations
- **WHEN** an authenticated user with active memberships in two organizations calls `GET /organizations`
- **THEN** the system returns `200` with `{ data: { organizations: [{ id, name, slug, role }, ...] } }` containing exactly those two organizations

#### Scenario: User without any membership
- **WHEN** a freshly signed-up user (no invitation accepted, no org created) calls `GET /organizations`
- **THEN** the system returns `200` with `{ data: { organizations: [] } }`

### Requirement: Update organization metadata (admin only)

The system SHALL allow updating an organization's `name` and other mutable metadata via `PATCH /organizations/:id`, restricted to members with the `admin` role on that organization. The `slug` SHALL NOT be mutable after creation.

#### Scenario: Admin updates organization name
- **WHEN** an admin of `org-123` calls `PATCH /organizations/org-123` with `{ name: "New Name" }`
- **THEN** the system updates the row, returns `200` with `{ data: { organization } }`, and emits an `organizations.updated` event

#### Scenario: Non-admin attempts update
- **WHEN** a member with role `comptable` calls `PATCH /organizations/org-123`
- **THEN** the system responds `403` with `{ error: { code: "FORBIDDEN_ROLE", message: "Requires admin role" } }`

#### Scenario: Slug change is rejected
- **WHEN** an admin includes `slug` in the PATCH body
- **THEN** the system ignores the `slug` field and responds `422` if `slug` is the only field provided

### Requirement: Send invitation to join an organization

The system SHALL allow an `admin` of an organization to invite a user by email and role via `POST /organizations/:id/invitations`. The system generates a single-use token (stored hashed in `invitations.token_hash`) valid for 7 days, dispatches an email containing the acceptance link, and creates an `invitations` row with `status = pending`.

#### Scenario: Admin invites a new user
- **WHEN** an admin calls `POST /organizations/org-123/invitations` with `{ email: "new@x.com", roleCode: "comptable" }`
- **THEN** the system creates an `invitations` row, sends an email with link `https://app/accept-invitation?token=<token>`, returns `201` with `{ data: { invitation: { id, email, roleCode, expiresAt, status: "pending" } } }`, and emits `organizations.invitation_sent`

#### Scenario: Non-admin attempts to invite
- **WHEN** a member with role `comptable` calls the invite endpoint
- **THEN** the system responds `403` with `{ error: { code: "FORBIDDEN_ROLE" } }`

#### Scenario: Duplicate pending invitation for same email
- **WHEN** an admin invites an email that already has a `pending` invitation in the same org
- **THEN** the system responds `409` with `{ error: { code: "INVITATION_ALREADY_PENDING" } }`

### Requirement: Accept an invitation

The system SHALL allow any user (authenticated or not) to accept an invitation via `POST /auth/invitations/accept` with the token. If the email does not correspond to an existing user, the request MUST include signup fields (`password`, `firstName`, `lastName`) and the system SHALL create the user and the membership atomically. Tokens MUST be single-use, MUST expire after 7 days, and MUST be invalidated on acceptance.

#### Scenario: Existing user accepts invitation
- **WHEN** a user with an existing account calls `POST /auth/invitations/accept` with a valid token matching their email
- **THEN** the system creates a `memberships` row with the role from the invitation, marks `invitations.status = accepted` and `accepted_at = now()`, returns `200` with `{ data: { organization, membership } }`, and emits `organizations.invitation_accepted`

#### Scenario: New user accepts invitation with signup
- **WHEN** an unregistered user calls accept with a valid token plus `{ password, firstName, lastName }`
- **THEN** the system creates the user, creates the membership, marks the invitation accepted, returns `201` with `{ data: { user, organization, membership } }`, and emits both `auth.signup` and `organizations.invitation_accepted`

#### Scenario: Expired token
- **WHEN** the token's `expires_at` is in the past
- **THEN** the system responds `410` with `{ error: { code: "INVITATION_EXPIRED" } }` and marks the invitation `status = expired`

#### Scenario: Reuse of a consumed token
- **WHEN** a token whose invitation `status = accepted` is replayed
- **THEN** the system responds `409` with `{ error: { code: "INVITATION_ALREADY_USED" } }`

### Requirement: Multi-tenant data isolation

Every endpoint under `/organizations/:id/*` and every business endpoint added by later modules SHALL verify that the authenticated user has an active `membership` in the target organization AND that the access token's `org_id` claim matches `:id`. Cross-tenant access MUST fail closed with HTTP 403 or 404 (never leak existence).

#### Scenario: User with token for org A queries org B
- **WHEN** a user holds an access token with `org_id = "org-A"` and calls any endpoint under `/organizations/org-B/...`
- **THEN** the system responds `404` (no information disclosure) and emits an `auth.cross_tenant_attempt` event

### Requirement: At least one active admin per organization

The system MUST refuse any operation that would result in an organization having zero active members with role `admin`. This includes role downgrade, membership suspension, membership deletion, and self-removal.

#### Scenario: Last admin attempts to downgrade themselves
- **WHEN** the only `admin` of `org-123` calls an endpoint to change their role to `comptable`
- **THEN** the system responds `409` with `{ error: { code: "ORG_LAST_ADMIN", message: "Cannot remove the last admin of the organization" } }`

#### Scenario: Last admin attempts to leave
- **WHEN** the only `admin` calls a membership-removal endpoint targeting themselves
- **THEN** the system responds `409` with `{ error: { code: "ORG_LAST_ADMIN" } }`

