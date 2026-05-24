## ADDED Requirements

### Requirement: OHADA reference chart of accounts is a read-only, system-segmented catalog

The system SHALL expose a global, immutable reference chart of accounts built from the SYSCOHADA AUDCIF révisé (effective 1 January 2018). Each reference account row MUST carry: `code` (2–10 digits), `label`, `class` (1–9), `account_type` (`TITLE` or `POSTING`), `normal_balance` (`D` or `C`), and `applicable_systems` (a non-empty subset of `{NORMAL, MINIMAL, ALLEGE}`). There SHALL be no API endpoint that mutates this catalog; only database migrations may write to `reference_chart_accounts`.

#### Scenario: Public read of the reference chart filtered by system
- **WHEN** any client calls `GET /reference-chart-of-accounts?system=NORMAL`
- **THEN** the system responds `200` with `{ data: { accounts: [...] }, error: null }` containing only the reference rows whose `applicable_systems` array includes `NORMAL`, ordered by `code` ascending

#### Scenario: No write endpoint on the reference catalog
- **WHEN** any client (regardless of role) attempts `POST`, `PATCH`, or `DELETE` on `/reference-chart-of-accounts/*`
- **THEN** the system responds `404` (route does not exist) — there is no write surface

### Requirement: Each organization is bound to exactly one accounting system, fixed at creation

When an organization is created, the caller MUST specify a `system` field whose value is one of `NORMAL`, `MINIMAL`, or `ALLEGE`. The system is recorded in `organization_accounting_configs` (1-1 with `organizations`) and is immutable thereafter — there is no API endpoint to change it.

#### Scenario: Organization creation with valid system
- **WHEN** a user calls `POST /organizations` with `{ name: "Cabinet KONAN", system: "NORMAL" }`
- **THEN** the system creates the organization, inserts a matching `organization_accounting_configs` row with `system = 'NORMAL'`, and triggers the reference-plan clone (see next requirement) — all in one transaction

#### Scenario: Organization creation without a system field
- **WHEN** a user calls `POST /organizations` with `{ name: "Cabinet KONAN" }` (no `system`)
- **THEN** the system responds `422` with `{ data: null, error: { code: "ACCOUNTING_SYSTEM_REQUIRED", message: "system field is required (NORMAL | MINIMAL | ALLEGE)" } }`

#### Scenario: Organization creation with invalid system value
- **WHEN** a user calls `POST /organizations` with `{ name: "X", system: "IFRS" }`
- **THEN** the system responds `422` with `{ error: { code: "ACCOUNTING_SYSTEM_REQUIRED" } }`

### Requirement: Reference plan is cloned into the organization at creation

Upon successful organization creation, the system SHALL clone every reference account whose `applicable_systems` includes the chosen system into `organization_chart_accounts`, preserving `code`, `label`, `class`, `account_type`, `normal_balance`, with `reference_account_id` pointing back to the source row and `parent_id` materialized via prefix lookup. The clone MUST complete within the same transaction as the organization insert — partial state is unacceptable.

#### Scenario: Cloning the Normal plan produces the full reference set
- **WHEN** an organization is created with `system = NORMAL`
- **THEN** every reference row matching `'NORMAL' = ANY(applicable_systems)` appears in `organization_chart_accounts` for that org, with `is_active = true` and `parent_id` correctly pointing to the direct prefix-parent (e.g., `4111` → `411` → `41` → `4` → NULL)

#### Scenario: Clone idempotency via the explicit import endpoint
- **WHEN** an admin calls `POST /organizations/:id/chart-of-accounts/import` for an org whose plan was already cloned
- **THEN** the system inserts only the missing rows (none, in the steady state) and responds `200` with `{ data: { added: 0, skipped: <count> } }` — no duplicates, no errors

### Requirement: Organization chart of accounts is tenant-isolated

Every read or write on `/organizations/:id/chart-of-accounts/*` MUST be gated by the Module 1 `TenantGuard`. A user holding an access token scoped to organization A who attempts to read or mutate accounts of organization B MUST receive `404` (not `403`) so the cross-tenant probe cannot infer the existence of B's resources.

#### Scenario: Cross-tenant read returns 404
- **WHEN** a user with `org_id = A` calls `GET /organizations/B/chart-of-accounts/<accountIdOfB>`
- **THEN** the system responds `404` with `{ error: { code: "ORG_NOT_FOUND" } }` and emits `auth.cross_tenant_attempt` (Module 1 audit)

### Requirement: Custom accounts can be added under any existing account, with prefix-derived parent

An authenticated user with `chart_of_accounts.write` permission MAY add a custom sub-account under any existing active account in their organization's chart. The new `code` MUST:
- match `/^\d{2,10}$/`;
- be strictly longer than the parent's `code`;
- have the parent's `code` as a prefix (`child.code.startsWith(parent.code)`);
- be unique within the organization (`UNIQUE(organization_id, code)`).

When the parent was `POSTING` and acquires its first child, the parent is automatically promoted to `TITLE`. The new account's `normal_balance` and `class` default to the parent's values.

#### Scenario: Adding a custom client account under 411
- **WHEN** an admin calls `POST /organizations/:id/chart-of-accounts` with `{ parentCode: "411", code: "41100001", label: "Client SOTRA" }`
- **THEN** the system creates an `organization_chart_accounts` row with `parent_id` = id-of-411, `class = 4`, `normal_balance = 'D'`, `account_type = 'POSTING'`, `reference_account_id = NULL`, `is_active = true`, and emits `chart_of_accounts.account_created` with `{ accountId, code, label, parentCode }`

#### Scenario: Code does not prefix-match parent
- **WHEN** an admin calls `POST /organizations/:id/chart-of-accounts` with `{ parentCode: "411", code: "5200001", label: "..." }`
- **THEN** the system responds `422` with `{ error: { code: "CHART_ACCOUNT_INVALID_PARENT", message: "Code must start with parent code (411)" } }`

#### Scenario: Code is not numeric or wrong length
- **WHEN** an admin calls `POST /organizations/:id/chart-of-accounts` with `{ code: "411A", ... }` or `{ code: "1", ... }` or `{ code: "12345678901", ... }`
- **THEN** the system responds `422` with `{ error: { code: "CHART_ACCOUNT_INVALID_CODE", message: "Code must be 2 to 10 digits" } }`

#### Scenario: Code already taken in the organization
- **WHEN** an admin calls `POST /organizations/:id/chart-of-accounts` with a `code` that already exists in the org's chart (reference-cloned or custom)
- **THEN** the system responds `409` with `{ error: { code: "CHART_ACCOUNT_CODE_TAKEN", message: "Code already used in this organization" } }`

#### Scenario: Parent promotion from POSTING to TITLE
- **WHEN** an admin adds the first child under a parent whose `account_type` was `POSTING`
- **THEN** the parent row's `account_type` is updated to `TITLE` in the same transaction, and `chart_of_accounts.account_updated` is emitted for the parent with `{ field: 'account_type', from: 'POSTING', to: 'TITLE' }`

### Requirement: Account code is immutable; only label and active state can be modified

Once created, an account's `code`, `class`, `normal_balance`, `parent_id`, and `reference_account_id` MUST be immutable via API. Only `label` and `is_active` MAY be updated via `PATCH /organizations/:id/chart-of-accounts/:accountId`. The system SHALL reject any attempt to modify the immutable fields with `422 CHART_ACCOUNT_IMMUTABLE_CODE`.

#### Scenario: Patch attempting to change the code
- **WHEN** an admin calls `PATCH /organizations/:id/chart-of-accounts/<id>` with `{ code: "9999" }`
- **THEN** the system responds `422` with `{ error: { code: "CHART_ACCOUNT_IMMUTABLE_CODE", message: "Field 'code' cannot be modified after creation" } }`

#### Scenario: Updating the label
- **WHEN** an admin calls `PATCH /organizations/:id/chart-of-accounts/<id>` with `{ label: "Clients - société du groupe" }`
- **THEN** the system updates the `label`, sets `updated_at = now()`, responds `200` with the updated view, and emits `chart_of_accounts.account_updated`

#### Scenario: Deactivating an account
- **WHEN** an admin calls `PATCH /organizations/:id/chart-of-accounts/<id>` with `{ isActive: false }`
- **THEN** the system sets `is_active = false`, responds `200`, and emits `chart_of_accounts.account_deactivated`

### Requirement: Account deletion is allowed only for custom leaf accounts

`DELETE /organizations/:id/chart-of-accounts/:accountId` MUST succeed only when ALL of the following are true:
- the account was created by the organization (`reference_account_id IS NULL`);
- the account has no active children in `organization_chart_accounts`;
- (future, Module 3) the account has never been posted to.

If any condition fails, the system responds `409` with `CHART_ACCOUNT_NOT_DELETABLE`.

#### Scenario: Deleting a custom leaf account
- **WHEN** an admin deletes a custom account with no children
- **THEN** the row is hard-deleted, the system responds `204`, and emits `chart_of_accounts.account_updated` with `{ action: 'deleted' }`

#### Scenario: Deleting a reference-cloned account is refused
- **WHEN** an admin attempts to delete an account whose `reference_account_id IS NOT NULL`
- **THEN** the system responds `409` with `{ error: { code: "CHART_ACCOUNT_NOT_DELETABLE", message: "Reference accounts cannot be deleted, only deactivated" } }`

#### Scenario: Deleting an account with active children is refused
- **WHEN** an admin attempts to delete an account that has at least one active child in `organization_chart_accounts`
- **THEN** the system responds `409` with `{ error: { code: "CHART_ACCOUNT_NOT_DELETABLE", message: "Account has active sub-accounts" } }`

### Requirement: RBAC permissions extend the Module 1 catalog

The system SHALL register two new permission codes — `chart_of_accounts.read` and `chart_of_accounts.write` — and assign them to roles per the following matrix:

| Role | `chart_of_accounts.read` | `chart_of_accounts.write` |
|------|--------------------------|---------------------------|
| `admin` | ✓ | ✓ |
| `expert_comptable` | ✓ | ✓ |
| `chef_mission` | ✓ | ✓ |
| `comptable` | ✓ | ✓ |
| `auditeur` | ✓ | ✗ |
| `client_readonly` | ✓ | ✗ |

#### Scenario: Auditor can read but not write
- **WHEN** a user with role `auditeur` calls `GET /organizations/:id/chart-of-accounts`
- **THEN** the system responds `200` with the chart

- **WHEN** the same user calls `POST /organizations/:id/chart-of-accounts`
- **THEN** the system responds `403` with `{ error: { code: "FORBIDDEN_PERMISSION" } }`

### Requirement: Chart of accounts events are journaled to `auth_events`

The system SHALL record an entry in `auth_events` for each of the following event types, using the Module 1 journaling infrastructure (`AuthEventsService.record`):
`chart_of_accounts.imported`, `chart_of_accounts.account_created`, `chart_of_accounts.account_updated`, `chart_of_accounts.account_deactivated`.

#### Scenario: Initial clone emits one event with the count
- **WHEN** an organization is created and the reference plan is cloned
- **THEN** an `auth_events` row of type `chart_of_accounts.imported` is written with `metadata = { system, accountCount }` and `organization_id` set

#### Scenario: Custom account creation emits an event
- **WHEN** an admin creates a custom account via `POST /organizations/:id/chart-of-accounts`
- **THEN** an `auth_events` row of type `chart_of_accounts.account_created` is written with `user_id` (actor), `organization_id`, IP, user agent, and `metadata = { accountId, code, label, parentCode }`
