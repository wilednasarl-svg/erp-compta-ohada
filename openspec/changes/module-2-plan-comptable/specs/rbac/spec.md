## ADDED Requirements

### Requirement: Permission catalog includes `chart_of_accounts.*` codes

The RBAC permission catalog SHALL include two additional permission codes — `chart_of_accounts.read` and `chart_of_accounts.write` — seeded via migration `0014_add_chart_of_accounts_permissions`. Both codes follow the existing `domain.action` naming convention and are assigned to roles per the matrix below.

| Role | `chart_of_accounts.read` | `chart_of_accounts.write` |
|------|--------------------------|---------------------------|
| `admin` | ✓ | ✓ |
| `expert_comptable` | ✓ | ✓ |
| `chef_mission` | ✓ | ✓ |
| `comptable` | ✓ | ✗ |
| `auditeur` | ✓ | ✗ |
| `client_readonly` | ✓ | ✗ |

The migration MUST be idempotent (`INSERT … ON CONFLICT DO NOTHING`) so re-running it in a partially-seeded environment is safe.

#### Scenario: Permissions cache reflects the new codes after migration
- **WHEN** migration `0014` has run and `PermissionsCacheService.roleHasPermission('role-admin', 'chart_of_accounts.write')` is queried
- **THEN** the cache returns `true` (loaded lazily from `role_permissions`)

#### Scenario: Migration is idempotent
- **WHEN** migration `0014` is replayed against a database where the codes and bindings already exist
- **THEN** the migration succeeds without error and produces no duplicate rows in `permissions` or `role_permissions`
