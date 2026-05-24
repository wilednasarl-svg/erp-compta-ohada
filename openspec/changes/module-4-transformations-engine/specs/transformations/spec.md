## ADDED Requirements

### Requirement: Source entries are immutable — transformations are additive artifacts

The system SHALL treat every row of `import_staging_entries` as **immutable** once persisted by Module 3. No code path in this module — service, repository, controller, or migration — MAY emit an `UPDATE` against `import_staging_entries.raw_values`, `mapped_values`, or any other column of the staging table. Every logical modification of an entry (reclassification, adjustment, future correction / ventilation / grouping) MUST be recorded as an additional row in `entry_transformations` carrying:

- `organization_id` (FK to `organizations`, ON DELETE CASCADE)
- `source_entry_id` (FK to `import_staging_entries`, ON DELETE CASCADE)
- `type` (string, one of `reclassification | adjustment | correction | ventilation | grouping`)
- `status` (string, one of `active | cancelled`, default `active`)
- `before_values` / `after_values` (JSONB sparse diffs — only changed fields)
- `notes` (free-form rationale, nullable)
- `created_by_id` (FK to `users`, ON DELETE RESTRICT) + `created_at`
- `cancelled_at` / `cancelled_by_id` / `cancel_reason` (nullable, for soft-delete in wave 2)

#### Scenario: Reclassifying an entry leaves the source row untouched
- **WHEN** a comptable reclassifies a staging entry by changing its account from `4111` to `6061`
- **THEN** `import_staging_entries` row for that entry is unchanged (`mapped_values` still contains `account: "4111"`), and a new `entry_transformations` row exists with `type='reclassification'`, `before_values={"account":"4111"}`, `after_values={"account":"6061"}`

#### Scenario: Adjusting an entry creates a separate artifact
- **WHEN** an expert_comptable creates a 1500 XOF adjustment debit on a staging entry
- **THEN** the source entry is untouched, and a new `entry_transformations` row exists with `type='adjustment'`, `after_values={"adjustmentDebit":"1500","adjustmentCredit":null,"adjustmentLabel":"..."}`, `before_values={}`

### Requirement: Reclassification requires at least one reclassifiable field

`POST /organizations/:id/transformations/reclassify` MUST accept an optional set of fields among `account`, `journal`, `partner`, `label`. At least one MUST be provided. If the DTO carries `sourceEntryId` only (no reclassifiable field), the system SHALL reject the request with `422 TRANSFORMATION_NO_FIELD_CHANGED` and persist nothing. The `before_values` JSONB MUST capture only the fields actually changed (sparse diff), not the entire mapped row.

#### Scenario: Reclassify with at least one field succeeds
- **WHEN** a user with `transformations.write` calls `POST /organizations/:id/transformations/reclassify` with `{ sourceEntryId, account: "6061", notes: "RAS bancaire" }`
- **THEN** the system responds `201` with the transformation summary; `before_values={"account":"<previous>"}`, `after_values={"account":"6061"}`; `imports`-related staging row is untouched

#### Scenario: Reclassify with no field is rejected
- **WHEN** a user calls `POST /organizations/:id/transformations/reclassify` with `{ sourceEntryId }` only
- **THEN** the system responds `422 TRANSFORMATION_NO_FIELD_CHANGED` and no row is created in `entry_transformations`

### Requirement: Adjustment requires exactly one of debit or credit (XOR)

`POST /organizations/:id/transformations/adjust` MUST require exactly one of `adjustmentDebit` or `adjustmentCredit` (positive decimal) plus a non-empty `adjustmentLabel`. Providing both, or neither, MUST be rejected with `422 TRANSFORMATION_ADJUSTMENT_INVALID`. The amount validation is regex-enforced at the DTO layer (`^\d+(\.\d{1,2})?$`); the XOR check is enforced at the service layer (so a future programmatic call cannot bypass it).

#### Scenario: Adjustment with exactly one amount succeeds
- **WHEN** a comptable calls `POST /organizations/:id/transformations/adjust` with `{ sourceEntryId, adjustmentDebit: "1500.00", adjustmentLabel: "Régularisation TVA Q1" }`
- **THEN** the system responds `201` and persists an `entry_transformations` row with `type='adjustment'`, `after_values={"adjustmentDebit":"1500.00","adjustmentCredit":null,"adjustmentLabel":"Régularisation TVA Q1"}`

#### Scenario: Adjustment with both debit and credit is rejected
- **WHEN** a user calls `POST /organizations/:id/transformations/adjust` with both `adjustmentDebit: "100"` and `adjustmentCredit: "100"` set
- **THEN** the system responds `422 TRANSFORMATION_ADJUSTMENT_INVALID` and persists nothing

#### Scenario: Adjustment with neither debit nor credit is rejected
- **WHEN** a user calls `POST /organizations/:id/transformations/adjust` with `adjustmentLabel` only (no amount)
- **THEN** the system responds `422 TRANSFORMATION_ADJUSTMENT_INVALID` and persists nothing

### Requirement: Cross-tenant access to source entries returns 404 (fail-closed)

`import_staging_entries` does not carry an `organization_id` column directly — its tenant scope is derived via the FK chain `import_staging_entries → import_files → import_sessions.organization_id`. `TransformationService` MUST resolve every source entry via an INNER JOIN on `import_sessions` filtering on the caller's organization_id. If the entry does not exist OR exists in another tenant, the system MUST respond `404 TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND` without revealing the difference. This fail-closed behavior aligns with the cross-tenant 404 policy of Modules 1, 2, and 3.

#### Scenario: Reclassifying an entry from another tenant returns 404
- **WHEN** a user with `org_id = A` calls `POST /organizations/A/transformations/reclassify` with `sourceEntryId` belonging to an `import_session` of `org_id = B`
- **THEN** the system responds `404 TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND`, no row is created in `entry_transformations`, and the response body MUST NOT disclose that the entry exists in another tenant

#### Scenario: Reading history of a cross-tenant entry returns 404
- **WHEN** a user with `org_id = A` calls `GET /organizations/A/transformations/entries/<entryIdOfB>/history`
- **THEN** the system responds `404 TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND`

### Requirement: Transformation history is chronological and includes cancelled entries

`GET /organizations/:id/transformations/entries/:entryId/history` MUST return the complete list of `entry_transformations` rows for the source entry, ordered by `created_at ASC` (oldest first). Cancelled transformations (`status='cancelled'`) MUST be included so the caller can render the full audit trail and reconstruct any undo/redo chain when wave 2 introduces the cancel endpoint. The endpoint requires `transformations.read` permission; tenant isolation MUST be enforced via the same JOIN on `import_sessions` used by the mutation endpoints.

#### Scenario: Empty history for a fresh source entry
- **WHEN** an auditeur calls `GET /organizations/:id/transformations/entries/:entryId/history` on an entry that has never been retraited
- **THEN** the system responds `200` with `{ history: [] }`

#### Scenario: History contains active and cancelled transformations in order
- **WHEN** a source entry has been reclassified (active), then adjusted (active), then a later reclassification was cancelled, and an auditeur calls the history endpoint
- **THEN** the system returns the 3 transformations ordered by `created_at ASC`, including the cancelled one with `status='cancelled'` and `cancelled_at` / `cancelled_by_id` populated

#### Scenario: Permission gate refuses client_readonly
- **WHEN** a user with role `client_readonly` (no `transformations.read`) calls the history endpoint
- **THEN** the system responds `403 FORBIDDEN_PERMISSION`
