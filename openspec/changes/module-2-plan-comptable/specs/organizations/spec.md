## MODIFIED Requirements

### Requirement: Organization creation requires an accounting system and triggers reference plan clone

When an organization is created via `POST /organizations`, the request body MUST include a `system` field whose value is one of `NORMAL`, `MINIMAL`, or `ALLEGE`. In a single database transaction, the system SHALL:

1. Insert the `organizations` row.
2. Insert the creating user's admin `memberships` row (unchanged from Module 1).
3. Insert the `organization_accounting_configs` row with `system` and `organization_id`.
4. Clone the reference chart of accounts for the chosen system into `organization_chart_accounts` (see `accounting-plan` capability).
5. Emit `chart_of_accounts.imported` to `auth_events` with `metadata = { system, accountCount }`.

If any step fails, the entire transaction MUST be rolled back — no half-provisioned organization can exist.

#### Scenario: Successful organization creation with NORMAL system
- **WHEN** a user calls `POST /organizations` with `{ name: "Cabinet KONAN", system: "NORMAL" }`
- **THEN** the system returns `201` with `{ data: { organization: { id, name, slug, system: "NORMAL" } }, error: null }`, the org has an `organization_accounting_configs` row, ~800 `organization_chart_accounts` rows, and an `auth_events` row of type `chart_of_accounts.imported`

#### Scenario: Missing system field rejects the request before any row is written
- **WHEN** a user calls `POST /organizations` with `{ name: "Cabinet KONAN" }` (no `system`)
- **THEN** the system responds `422` with `{ error: { code: "ACCOUNTING_SYSTEM_REQUIRED" } }` and no row is created in `organizations`, `memberships`, `organization_accounting_configs`, or `organization_chart_accounts`

#### Scenario: Clone failure rolls back the organization
- **WHEN** the reference plan clone fails mid-flight (e.g., unique constraint violation due to a corrupted seed)
- **THEN** the surrounding transaction rolls back, leaving zero rows in `organizations`, `memberships`, `organization_accounting_configs`, and `organization_chart_accounts` for the attempted org, and the API returns `500` with `{ error: { code: "INTERNAL_ERROR" } }`

### Requirement: Organization read endpoints expose the accounting system

The system SHALL include the accounting system in the public read shape of an organization. `GET /organizations` (list) and the implicit shape returned by `POST /organizations` and `PATCH /organizations/:id` MUST include `system` (one of `NORMAL`, `MINIMAL`, `ALLEGE`).

#### Scenario: List orgs includes system
- **WHEN** a user calls `GET /organizations`
- **THEN** each entry in `data.organizations[]` contains `{ id, name, slug, role, system }`

#### Scenario: No endpoint mutates `system`
- **WHEN** any client attempts `PATCH /organizations/:id` with `{ system: "MINIMAL" }`
- **THEN** the system ignores the `system` field (no validation error, no change) — the `UpdateOrganizationDto` does not whitelist `system`. Changing accounting system after creation is out of scope for this module.
