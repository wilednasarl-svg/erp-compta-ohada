## ADDED Requirements

### Requirement: Rule definitions are tenant-isolated and support priority evaluation

The system SHALL support creating, reading, updating, and deleting (CRUD) rules that are strictly tenant-isolated. Each rule belongs to an organization and must only be visible/mutable by users with proper membership and permissions in that tenant. A rule consists of:
- `name` (string, non-empty, unique per tenant)
- `description` (string, nullable)
- `isActive` (boolean, defaults to true)
- `priority` (integer, non-negative, where lower values are evaluated first)
- `conditions` (JSONB array of `RuleCondition` objects)
- `actions` (JSONB array of `RuleAction` objects)

Every repository and service operation on rules MUST enforce tenant-scoping using the standard `assertTenantId` gate.

#### Scenario: Active rules are fetched and evaluated in order of ascending priority
- **WHEN** rules are queried for execution on a tenant's import session
- **THEN** only rules with `isActive=true` are fetched, and they are ordered by `priority ASC` (e.g., priority 0 is evaluated before priority 10)

#### Scenario: Cross-tenant rule modification is blocked (fail-closed)
- **WHEN** a user of tenant A attempts to read or update a rule belonging to tenant B
- **THEN** the system SHALL respond `404 RULE_NOT_FOUND` to prevent leaking rule existence across tenants

---

### Requirement: Conditions and actions support predefined whitelisted DSL operators

The rule engine SHALL validate conditions and actions against a strict server-side whitelist.
Whitelisted conditions:
1. `account_prefix` : checks if the entry's account starts with a specific prefix (e.g., "62")
2. `account_in` : checks if the entry's account is in a list of accounts
3. `journal_in` : checks if the entry's journal code is in a list of journals
4. `amount_range` : checks if the entry's amount (debit or credit) falls within `min` and `max` limits
5. `label_contains` : checks if the entry's label contains a substring (case-insensitive)
6. `date_range` : checks if the entry's date falls within a specified window

Whitelisted actions:
1. `reclassify_account` : changes the mapped account
2. `reclassify_journal` : changes the mapped journal
3. `assign_cost_center` : assigns an analytical cost center
4. `add_tag` : appends a tag to the entry metadata

If a condition or action with an invalid or unknown `type` is submitted, the system MUST reject it with `422 RULE_INVALID_CONDITION` or `422 RULE_INVALID_ACTION`.

#### Scenario: Creating a rule with a valid DSL succeeds
- **WHEN** a user with `rules.write` posts a rule with a valid `account_prefix` condition and `reclassify_account` action
- **THEN** the system responds `201 Created` and persists the rule

#### Scenario: Creating a rule with an unknown condition type is rejected
- **WHEN** a user posts a rule definition containing a condition of type `"invalid_op"`
- **THEN** the system responds `422 RULE_INVALID_CONDITION` and persists nothing

---

### Requirement: Rules simulation performs pure preview without side-effects

`POST /organizations/:id/rules/:ruleId/simulate` and `POST /organizations/:id/rules/simulate` (run-all simulation) SHALL retrieve the staging entries in scope, evaluate the conditions of the rule(s), and return the preview of matches (which entry IDs matched, which actions would apply, and what the `before` vs `after` values would look like) without inserting any rows in `entry_transformations`.
A simulation MUST persist a log in `rule_executions` with `mode='simulation'`.

#### Scenario: Simulation returns preview but creates no transformations
- **WHEN** a user calls `POST /organizations/:id/rules/:ruleId/simulate`
- **THEN** the response is `201 Created` with a summary of matched entries; no transformations are written to the database, but a `RuleExecution` record with `mode='simulation'` is persisted

---

### Requirement: Rules application creates additive transformations (Module 4) best-effort with error logging

`POST /organizations/:id/rules/:ruleId/apply` and `POST /organizations/:id/rules/apply` (run-all application) SHALL execute the rule(s) on the scoped staging entries. For each match, the engine MUST delegate the action to `TransformationService` to create a real `entry_transformations` row.
The operation is **best-effort**: if transforming entry K fails, the engine SHALL log the error in the execution record, continue processing entries K+1..N, and successfully complete without a database-wide rollback.

#### Scenario: Applying a rule successfully creates transformations
- **WHEN** a user with `rules.apply` posts to the apply endpoint for a rule that matches 3 entries
- **THEN** the system creates 3 new rows in `entry_transformations` with notes `Règle automatique: <ruleName>`, persists a `rule_executions` log with `mode='apply'`, `matchedCount=3`, `appliedCount=3`, and `transformationIds` containing the 3 UUIDs

#### Scenario: Applying a rule with partial errors continues and logs errors
- **WHEN** an apply operation matches 5 entries, but the 3rd entry fails to transform (e.g. database constraint or invalid account)
- **THEN** the system continues to process entries 4 and 5; the persisted `RuleExecution` has `matchedCount=5`, `appliedCount=4`, and the `error` column captures the first failure message

---

### Requirement: Rule executions log matches and matched snapshots in an append-only ledger

Every rule simulation or application MUST be recorded in the `rule_executions` table as an append-only audit trail. This ledger MUST capture:
- `organization_id` (FK to `organizations`, ON DELETE CASCADE)
- `rule_id` (FK to `rules`, ON DELETE CASCADE)
- `mode` (`simulation` | `apply`)
- `scope` (JSONB capturing the filters used, e.g., `{ importSessionId }`)
- `matched_count` (integer)
- `applied_count` (integer)
- `transformation_ids` (JSONB array of UUIDs created, defaults to empty)
- `matches_snapshot` (JSONB array of match details per entry)
- `error` (text, nullable)
- `executed_by` (FK to `users`, ON DELETE RESTRICT)

The `rule_executions` rows are append-only; no UPDATE or DELETE endpoint is exposed.

#### Scenario: Execeution history can be read in chronological order
- **WHEN** a user with `rules.read` queries `/organizations/:id/rules/:ruleId/executions`
- **THEN** the system returns all executions for that rule, ordered by `created_at DESC`
