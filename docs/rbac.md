# RBAC — roles × permissions matrix

Seeded by migrations `0003_create_roles.ts` and
`0005_create_role_permissions.ts`. Read paths:

- The catalog lives in Postgres (`roles`, `permissions`,
  `role_permissions`); the seed is idempotent (`ON CONFLICT DO NOTHING`).
- Service / controller code consults the matrix via
  `RolePermissionRepository.roleHasPermission(roleId, permissionCode)`,
  invoked from `PermissionsGuard`.
- Frontend / human readers should treat THIS document as the contract.
  Any drift between the seed and this table is a bug — fix both.

## Roles (system, seeded)

| Code | Name | Description |
|---|---|---|
| `admin` | Administrator | Full control over the organization, users, billing, accounting. The "owner" role created at `POST /organizations`. |
| `expert_comptable` | Expert-comptable | Senior accountant. Can sign final accounting documents. |
| `chef_mission` | Chef de mission | Supervises a client mission; validates intermediate steps. |
| `comptable` | Comptable | Data entry and restatements; no validation authority. |
| `auditeur` | Auditeur | Read-only on accounting + export audit trail. |
| `client_readonly` | Client (read-only) | Read-only access scoped to the client's own dossier. |

`is_system = true` on every seeded role — they must never be deleted or
renamed via the API (enforced by `RBAC_SYSTEM_ROLE_LOCKED`, 403, on any
admin mutation endpoint we wire later).

## Matrix

|                                 | admin | expert_comptable | chef_mission | comptable | auditeur | client_readonly |
|---------------------------------|:-----:|:----------------:|:------------:|:---------:|:--------:|:---------------:|
| `organizations.read`            |   ✓   |        ✓         |      ✓       |     ✓     |    ✓     |        ✓        |
| `organizations.update`          |   ✓   |        ✓         |              |           |          |                 |
| `organizations.invite`          |   ✓   |        ✓         |              |           |          |                 |
| `organizations.manage_members`  |   ✓   |                  |              |           |          |                 |
| `users.manage_roles`            |   ✓   |        ✓         |              |           |          |                 |
| `users.suspend`                 |   ✓   |        ✓         |              |           |          |                 |
| `accounting.read`               |   ✓   |        ✓         |      ✓       |     ✓     |    ✓     |        ✓        |
| `accounting.write`              |   ✓   |        ✓         |      ✓       |     ✓     |          |                 |
| `accounting.validate`           |   ✓   |        ✓         |      ✓       |           |          |                 |
| `accounting.sign`               |   ✓   |        ✓         |              |           |          |                 |
| `audit.read`                    |   ✓   |        ✓         |      ✓       |           |    ✓     |                 |
| `audit.export`                  |   ✓   |        ✓         |              |           |    ✓     |                 |
| `mfa.manage_self`               |   ✓   |        ✓         |      ✓       |     ✓     |    ✓     |        ✓        |
| `chart_of_accounts.read`        |   ✓   |        ✓         |      ✓       |     ✓     |    ✓     |        ✓        |
| `chart_of_accounts.write`       |   ✓   |        ✓         |      ✓       |           |          |                 |
| `imports.read`                  |   ✓   |        ✓         |      ✓       |     ✓     |    ✓     |        ✓        |
| `imports.write`                 |   ✓   |        ✓         |      ✓       |     ✓     |          |                 |
| `imports.commit`                |   ✓   |        ✓         |      ✓       |     ✓     |          |                 |
| `documents.read`                |   ✓   |        ✓         |      ✓       |     ✓     |    ✓     |        ✓        |
| `documents.write`               |   ✓   |        ✓         |      ✓       |     ✓     |          |                 |
| `audit_logs.read`               |   ✓   |        ✓         |      ✓       |           |    ✓     |                 |
| `transformations.read`          |   ✓   |        ✓         |      ✓       |     ✓     |    ✓     |                 |
| `transformations.write`         |   ✓   |        ✓         |      ✓       |     ✓     |          |                 |
| `rules.read`                    |   ✓   |        ✓         |      ✓       |     ✓     |    ✓     |                 |
| `rules.write`                   |   ✓   |        ✓         |      ✓       |           |          |                 |
| `rules.simulate`                |   ✓   |        ✓         |      ✓       |     ✓     |          |                 |
| `rules.apply`                   |   ✓   |        ✓         |      ✓       |           |          |                 |
| `workflows.read`                |   ✓   |        ✓         |      ✓       |     ✓     |    ✓     |                 |
| `workflows.transition`          |   ✓   |        ✓         |      ✓       |           |          |                 |

> **Note on `chart_of_accounts.write`** — the rôle `comptable` (saisie)
> is intentionally **excluded**. Letting every data-entry user spawn
> ad-hoc sub-accounts produces chart drift that pollutes inter-dossier
> balances and breaks the firm's analytical consistency. Creating
> custom accounts is a governance decision and is reserved to roles
> with sign-off authority (admin, expert-comptable, chef de mission).
> See Module 2 design.md (D6) for the rationale.

## Guard composition

```ts
@Controller('organizations/:id')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class SomeController {
  @Get()
  @RequirePermission('organizations.read')
  async read() { /* … */ }

  @Patch('members/:userId')
  @RequirePermission('organizations.manage_members')
  async changeRole() { /* … */ }
}
```

- **`JwtAuthGuard`** — validates the Bearer token, binds
  `req.context.currentUser`. `@Public()` opts out.
- **`TenantGuard`** — verifies an active membership for
  `(currentUser, currentOrg.tokenOrgId)`, binds
  `req.context.currentOrg = { id, roleId, role, membershipId }`.
  Missing membership → 404 `ORG_NOT_FOUND` + emits
  `auth.cross_tenant_attempt`.
- **`PermissionsGuard`** — **deny-by-default**. A handler without
  `@RequirePermission(code)` triggers 403 `RBAC_NO_POLICY_DECLARED`.
  This is intentional: a forgotten annotation should fail loud, not
  silently expose data.
- **`RolesGuard`** — opt-in. Use `@Roles('admin', ...)` for endpoints
  whose policy is naturally role-shaped rather than permission-shaped
  (the few admin-only management routes).

## Invariants

- **At least one active admin per organization**
  (`MembershipsService.changeRole`): refuses any downgrade that would
  leave the org without an admin. Returns 409 `ORG_LAST_ADMIN`.
- **Multi-tenant scope**: every repository whose table carries
  `organization_id` requires a `TenantId | string` parameter,
  validated by `assertTenantId`. A missing scope is a compile-time
  error via the `TenantId` brand; an empty string is a fast runtime
  reject. See `apps/backend/src/common/persistence/tenant-scope.ts`.
- **Cross-tenant attempts are audited**: every TenantGuard rejection
  with an authenticated user emits `auth.cross_tenant_attempt`
  (with `ipAddress`, `userAgent`, `userId`, `attemptedOrgId`) so
  brute-force enumeration is correlatable from the journal alone.
