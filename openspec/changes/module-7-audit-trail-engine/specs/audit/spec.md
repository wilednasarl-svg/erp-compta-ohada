## ADDED Requirements

### Requirement: Unified audit log table for every business-state mutation

The system SHALL maintain a single `audit_logs` table that records every mutation of business state — across `auth`, `organizations`, `rbac`, `chart_of_accounts`, `accounting`, `imports`, `transformations`, `rules`, `workflows`, `reports`, `documents`, and `ai` modules. Each row MUST carry:

- `user_id` (nullable — system jobs and unauthenticated failures have no actor)
- `organization_id` (nullable — tenant-less events such as failed signup)
- `module` (string, from the `AuditModule` union)
- `action` (string, free-form scoped by module)
- `entity_type` / `entity_id` (nullable, point to the row being mutated)
- `before` / `after` (JSONB, nullable, capture the diff for UPDATEs)
- `event_type` (compound `module.action`, kept for `auth_events` view back-compat)
- `ip_address`, `user_agent`, `metadata`, `created_at`

#### Scenario: Recording a chart-of-accounts update writes before/after
- **WHEN** an admin renames account `411` from "Clients" to "Clients tiers"
- **THEN** `audit_logs` receives a row with `module='chart_of_accounts'`, `action='account_updated'`, `entity_type='OrganizationAccountEntity'`, `entity_id='<acct-uuid>'`, `before={"label":"Clients"}`, `after={"label":"Clients tiers"}`

#### Scenario: Login success records under module='auth'
- **WHEN** a user successfully authenticates
- **THEN** `audit_logs` receives a row with `module='auth'`, `action='login_success'`, `event_type='auth.login_success'`, `before=null`, `after=null`

### Requirement: `auth_events` is preserved as a back-compat Postgres view

The Module 1 table `auth_events` SHALL be replaced by a Postgres `VIEW auth_events AS SELECT * FROM audit_logs WHERE module IN ('auth','organizations','rbac')`. The view's column shape MUST match what `AuthEventEntity` expected (column names and types preserved). Module 1 services and controllers (`AuthEventsService`, `AuthEventsController`, `AuthEventRepository`) MUST continue to function without code change.

#### Scenario: Module 1's AuthEventsController only sees auth-relevant events
- **WHEN** a chart_of_accounts update is recorded (via `module='chart_of_accounts'`)
- **THEN** `GET /organizations/:id/auth-events` does NOT return that row (it's not in the `auth_events` view)
- **AND** `GET /audit/logs?module=chart_of_accounts` DOES return it

### Requirement: API is append-only — no UPDATE, no DELETE endpoints

The HTTP surface for audit logs SHALL expose only read endpoints. No `POST` (the only writer is the internal `AuditTrailService.record`), no `PATCH`, no `DELETE`. A future hardening pass MAY add a Postgres `BEFORE UPDATE / DELETE` trigger that raises an exception, but the API-level guarantee is sufficient for MVP.

#### Scenario: There is no mutation endpoint on /audit/logs
- **WHEN** any client (regardless of role, including admin) attempts `POST /audit/logs/...`, `PATCH /audit/logs/...`, or `DELETE /audit/logs/...`
- **THEN** the system responds `404` — the route does not exist

### Requirement: Listing audit logs is tenant-scoped and permission-gated

`GET /audit/logs` MUST be guarded by `JwtAuthGuard + TenantGuard + PermissionsGuard` with `@RequirePermission('audit.read')`. Results MUST filter on `organization_id = currentOrg.id` (or include only `organization_id IS NULL` rows for tenant-less events the caller is meant to see).

#### Scenario: Cross-tenant listing is impossible
- **WHEN** a user with `org_id = A` calls `GET /audit/logs?module=imports`
- **THEN** the system returns only rows where `organization_id = A` or `organization_id IS NULL`; never returns rows for `org_id = B`

#### Scenario: Permission gate refuses comptable
- **WHEN** a `comptable` (no `audit.read`) calls `GET /audit/logs`
- **THEN** the system responds `403 FORBIDDEN_PERMISSION`

### Requirement: Filterable by module, action, entity, user, date range

`GET /audit/logs` MUST accept query parameters `module`, `action`, `entityId`, `userId`, `dateFrom`, `dateTo`, `page`, `pageSize`. Each filter that is set MUST narrow the result; unset filters MUST NOT constrain the query.

#### Scenario: Drilling down to a single account's history
- **WHEN** an admin calls `GET /audit/logs?entityId=<account-uuid>`
- **THEN** the system returns the chronologically ordered list of all `audit_logs` rows whose `entity_id = <account-uuid>`, regardless of module

#### Scenario: Date range filter
- **WHEN** an auditeur calls `GET /audit/logs?dateFrom=2026-04-01&dateTo=2026-04-30`
- **THEN** the system returns only rows with `created_at` within April 2026

## MODIFIED Requirements

### Requirement: Authentication events are journaled

The system SHALL emit append-only events to the `auth_events` view (which projects from `audit_logs`) for: `signup`, `login_success`, `login_failed`, `logout`, `mfa_challenge_issued`, `mfa_enabled`, `mfa_disabled`, `mfa_verification_failed`, `refresh_token_reuse_detected`, `cross_tenant_attempt`, `role_changed`, `invitation_sent`, `invitation_revoked`, `invitation_accepted`. The shape published by `AuthEventsService.record` MUST remain the same (`{ event_type, user_id, organization_id, ip_address, user_agent, metadata }`) — the new `module` / `action` / `entity_*` / `before` / `after` columns are populated by `AuditTrailService` for non-auth modules and may be NULL for legacy auth events.

#### Scenario: A successful login still works exactly as before
- **WHEN** a user signs in successfully via `POST /auth/login`
- **THEN** the `auth_events` view contains a new row with `event_type='auth.login_success'`, `user_id=<user>`, `ip_address=<ip>`, and the existing Module 1 `AuthEventsController` projection sees that row unchanged
