# rbac Specification

## Purpose
Modèle de contrôle d'accès par rôle pour cabinets comptables OHADA. Six rôles métier prédéfinis (`admin`, `expert-comptable`, `chef-mission`, `comptable`, `auditeur`, `client-lecture-seule`) liés à un catalogue de permissions via `role_permissions`. Vérification systématique sur chaque endpoint protégé via la trilogie `JwtAuthGuard` → `TenantGuard` → `PermissionsGuard` (deny-by-default). Garantit l'invariant "au moins un admin actif par organisation" via une mise à jour SQL atomique avec `SELECT … FOR UPDATE`.
## Requirements
### Requirement: Six seeded business roles

The system SHALL seed the following six roles in the `roles` table at migration time, with `is_system = true` (non-deletable, non-renamable via API):

| code | name | description |
|------|------|-------------|
| `admin` | Administrateur | Full control over the organization, users, billing, and all accounting data |
| `expert_comptable` | Expert-comptable | Final validation, signature, all read/write on accounting |
| `chef_mission` | Chef de mission | Supervises a client mission, validates intermediate steps |
| `comptable` | Comptable | Data entry, restatements, no validation authority |
| `auditeur` | Auditeur | Read + comment + export, no write on accounting data |
| `client_readonly` | Client (lecture seule) | Read-only access scoped to the client's own dossier |

#### Scenario: Roles are seeded on fresh install
- **WHEN** the database is migrated from empty state
- **THEN** the `roles` table contains exactly these six rows with `is_system = true` and stable `code` values

#### Scenario: System role cannot be deleted via API
- **WHEN** any client calls a delete endpoint on a system role
- **THEN** the system responds `403` with `{ error: { code: "RBAC_SYSTEM_ROLE_LOCKED" } }`

### Requirement: Permissions are assigned to roles, never directly to users

The system SHALL store permissions as rows in `permissions(code, description)` and link them to roles via `role_permissions(role_id, permission_id)`. There MUST NOT be any table or API that grants a permission directly to a user — authorization is always derived through `User → Membership(role) → Role → Permission`.

#### Scenario: User permission set is derived through membership
- **WHEN** the system needs to know if user `U` can perform action `accounting.write` in organization `O`
- **THEN** the system looks up the active membership `(U, O)`, reads its `role`, and checks whether that role has the `accounting.write` permission in `role_permissions`

#### Scenario: No direct user-permission table exists
- **WHEN** the schema is inspected
- **THEN** no table `user_permissions` (or equivalent direct grant) exists; permissions are exclusively bound to roles

### Requirement: Seeded permission catalog

The system SHALL seed at minimum the following permission codes, distributed across the six roles:

- `organizations.read`, `organizations.update`, `organizations.invite`, `organizations.manage_members`
- `users.manage_roles`, `users.suspend`
- `accounting.read`, `accounting.write`, `accounting.validate`, `accounting.sign`
- `audit.read`, `audit.export`
- `mfa.manage_self`

The default mapping SHALL be:
- `admin` → all of the above
- `expert_comptable` → all except `organizations.manage_members` (which stays admin-only); includes `accounting.sign`
- `chef_mission` → `accounting.read`, `accounting.write`, `accounting.validate`, `audit.read`, `organizations.read`, `mfa.manage_self`
- `comptable` → `accounting.read`, `accounting.write`, `organizations.read`, `mfa.manage_self`
- `auditeur` → `accounting.read`, `audit.read`, `audit.export`, `organizations.read`, `mfa.manage_self`
- `client_readonly` → `accounting.read` (scoped to own dossier), `organizations.read`, `mfa.manage_self`

#### Scenario: Permissions are seeded with role mappings
- **WHEN** the database is migrated from empty state
- **THEN** the `permissions` table contains at least the codes listed above, and `role_permissions` contains the mappings defined above

### Requirement: Authorization is enforced by a single guard layer

The system SHALL enforce authorization on every protected endpoint through a centralized guard pipeline (NestJS `JwtAuthGuard` → `TenantGuard` → `RolesGuard`/`PermissionsGuard`). Controllers MUST declare required permissions via a `@RequirePermission('code')` or `@Roles('code', ...)` decorator. An endpoint without an explicit decorator MUST be rejected by default (deny by default).

#### Scenario: Endpoint without explicit permission declaration
- **WHEN** a protected controller method is missing both `@RequirePermission` and `@Roles` decorators
- **THEN** the guard pipeline responds `403` with `{ error: { code: "RBAC_NO_POLICY_DECLARED" } }`, even for an authenticated user

#### Scenario: User has required permission
- **WHEN** an authenticated user with `role = comptable` (which has `accounting.write`) calls an endpoint annotated `@RequirePermission('accounting.write')`
- **THEN** the request proceeds to the controller

#### Scenario: User lacks required permission
- **WHEN** an authenticated user with `role = auditeur` (which does NOT have `accounting.write`) calls an endpoint annotated `@RequirePermission('accounting.write')`
- **THEN** the system responds `403` with `{ error: { code: "FORBIDDEN_PERMISSION", message: "Missing permission accounting.write" } }`

### Requirement: Role assignment is journaled

The system SHALL emit an event whenever a user's role in an organization is changed, created, or revoked. The event MUST capture `actor_user_id`, `target_user_id`, `organization_id`, `from_role`, `to_role`, and a timestamp.

#### Scenario: Admin promotes a member
- **WHEN** an admin changes a member's role from `comptable` to `chef_mission`
- **THEN** the system writes an `organizations.role_changed` event in `auth_events` (or its successor table) with the actor, target, and `from_role`/`to_role`

### Requirement: Authorization checks are tenant-scoped

The system MUST evaluate every permission check in the context of the access token's `org_id` claim. A user with role `admin` in organization A MUST NOT receive `admin` privileges in organization B, even if both organizations exist.

#### Scenario: Admin of org A queries org B
- **WHEN** a user holds an access token with `org_id = "A"` and `role = "admin"`, and attempts to call an endpoint that resolves to organization B
- **THEN** the `TenantGuard` responds `404` (fail closed, no disclosure) before any permission check on `B` is evaluated

