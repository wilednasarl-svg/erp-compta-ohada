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

### Requirement: `auth_events` table is extended in place; no RENAME, no view

The Module 1 table `auth_events` SHALL be **extended in place** by migration `0019` with the new columns (`module`, `action`, `entity_type`, `entity_id`, `before`, `after`, `request_id`). No table rename and no Postgres view are introduced — the physical table keeps its name `auth_events` and is mapped by **two** TypeORM entities pointing at the same row shape:

- `AuthEventEntity` (Module 1) — legacy projection used by `AuthEventsController` under `/organizations/:id/auth-events`. Sees only the columns Module 1 has always known.
- `AuditLogEntity` (Module 7) — modern projection exposing all columns including `module`, `action`, `entity_type`, `entity_id`, `before`, `after`. Backs the new `/audit/logs` endpoint.

The write path is **unified**: `AuthEventsService.record(eventType, ctx, metadata)` derives `module` + `action` from `eventType` (split on first `.`) and delegates to `AuditTrailService.record`, which is the only sanctioned writer. The legacy `AuthEventRepository.record` MUST be **removed** in this change — post-0019 it would insert NULL into the NOT NULL `module` / `action` columns and crash. `AuthEventRepository` is preserved as a read-only accessor for `AuthEventsController` (the `/organizations/:id/auth-events` projection).

#### Scenario: Both entities address the same physical row
- **WHEN** an `auth.login_success` is recorded via `AuthEventsService.record('auth.login_success', ctx)`
- **THEN** the same row is observable via both `AuthEventEntity` (`event_type='auth.login_success'`) and `AuditLogEntity` (`module='auth'`, `action='login_success'`, `event_type='auth.login_success'`)

#### Scenario: `AuthEventRepository.record` is removed
- **WHEN** any future code attempts to call `AuthEventRepository.record(...)`
- **THEN** TypeScript MUST fail the build — the method does not exist; the only sanctioned write path is `AuditTrailService.record` (called either directly by Module 7+ emitters or indirectly via `AuthEventsService.record` for Module 1 codes)

### Requirement: API is append-only — no UPDATE, no DELETE endpoints

The HTTP surface for audit logs SHALL expose only read endpoints. No `POST` (the only writer is the internal `AuditTrailService.record`), no `PATCH`, no `DELETE`. A future hardening pass MAY add a Postgres `BEFORE UPDATE / DELETE` trigger that raises an exception, but the API-level guarantee is sufficient for MVP.

#### Scenario: There is no mutation endpoint on /audit/logs
- **WHEN** any client (regardless of role, including admin) attempts `POST /audit/logs/...`, `PATCH /audit/logs/...`, or `DELETE /audit/logs/...`
- **THEN** the system responds `404` — the route does not exist

### Requirement: Listing audit logs is tenant-scoped and permission-gated

`GET /audit/logs` MUST be guarded by `JwtAuthGuard + TenantGuard + PermissionsGuard` with `@RequirePermission('audit.read')`. Results MUST filter **strictly** on `organization_id = currentOrg.id`. Tenant-less rows (`organization_id IS NULL` — e.g. a failed signup before org selection, cross-tenant attack telemetry) are **never** returned through this endpoint. Operators who need to see system-wide audit must use a privileged out-of-band path (DB console, future `/admin/audit` route), not the tenant-scoped UI.

This is more restrictive than the natural `tenant_id IS NULL OR tenant_id = current` form: a comptable from org A should not be able to see a failed signup by `attacker@evil.com` that has no org binding — the existence of that row already leaks reconnaissance info.

#### Scenario: Cross-tenant listing is impossible
- **WHEN** a user with `org_id = A` calls `GET /audit/logs?module=imports`
- **THEN** the system returns only rows where `organization_id = A`; never returns rows for `org_id = B` and never returns rows where `organization_id IS NULL`

#### Scenario: Tenant-less rows are invisible to org members
- **WHEN** a failed `auth.signup` (no `organization_id`) is recorded, then a user from any org calls `GET /audit/logs`
- **THEN** that row does NOT appear in the response

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
