## ADDED Requirements

### Requirement: Imports are scoped to a session with an explicit lifecycle

The system SHALL model every import as an `ImportSession` row in `import_sessions` (`organization_id`, `created_by_user_id`, `name`, `source_type`, `status`). A session MUST transition through a documented machine: `draft → parsing → parsed → validated → ready_for_import → completed | failed`. Every state change is recorded with a timestamp; reverse transitions are forbidden.

#### Scenario: Successful session creation
- **WHEN** an authenticated user with `imports.write` calls `POST /organizations/:id/imports/sessions` with `{ name: "BICICI Avril 2026", sourceType: "csv" }`
- **THEN** the system responds `201` with `{ data: { session: { id, status: "draft", ... } }, error: null }` and emits `imports.session_created` to `auth_events`

#### Scenario: Session listing is tenant-scoped
- **WHEN** a user with `org_id = A` calls `GET /organizations/A/imports/sessions`
- **THEN** the system returns only sessions whose `organization_id = A`, never sessions from another org regardless of role

#### Scenario: Cross-tenant session read returns 404
- **WHEN** a user with `org_id = A` calls `GET /organizations/B/imports/sessions/<sessionIdOfB>`
- **THEN** the system responds `404 ORG_NOT_FOUND` (never 403) and emits `auth.cross_tenant_attempt`

### Requirement: File uploads are validated server-side against an allowlist

Every `POST /organizations/:id/imports/sessions/:sessionId/files` MUST validate the uploaded file against a fixed MIME allowlist (`text/csv`, `text/plain`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel`) and a size cap (50 MB). The MIME is determined server-side from the multipart payload — the client-supplied filename extension is informational only. Files outside the allowlist or above the cap MUST be rejected before any disk write.

#### Scenario: Upload of a permitted CSV
- **WHEN** a user uploads `bicici-avril.csv` (`text/csv`, 2 MB) to a draft session
- **THEN** the system persists an `import_files` row with `status = uploaded`, computes the SHA-256 hash, returns `201` and emits `imports.file_uploaded`

#### Scenario: Upload of an EXE renamed `.csv`
- **WHEN** a user uploads an MZ-headered executable renamed `payload.csv`
- **THEN** the system responds `422 IMPORT_UNSUPPORTED_FORMAT` and persists nothing to disk

#### Scenario: Upload exceeding the size limit
- **WHEN** a user uploads a 60 MB file (above the 50 MB cap)
- **THEN** the system responds `413 IMPORT_FILE_TOO_LARGE` before reading the full body

#### Scenario: Upload to a non-draft session
- **WHEN** a user uploads a file to a session whose status is `parsing`, `parsed`, `completed`, or `failed`
- **THEN** the system responds `409 IMPORT_SESSION_NOT_DRAFT` and the staging layer is untouched

### Requirement: Files are deduplicated by SHA-256 within a session

The system SHALL reject a second upload of the same file (identical SHA-256) within the same session with `409 IMPORT_FILE_DUPLICATE`. Identical hashes in DIFFERENT sessions are permitted (legitimate re-import after session abandonment).

#### Scenario: Duplicate upload in same session
- **WHEN** a user uploads `bicici.csv` twice into the same draft session
- **THEN** the second upload returns `409 IMPORT_FILE_DUPLICATE` and no second `import_files` row is created

### Requirement: Parsing populates a staging table without touching real accounting tables

When the user triggers `POST /organizations/:id/imports/sessions/:sessionId/preview` (or per-file parse), the system MUST dispatch to the right parser based on the validated server-side MIME and insert one `import_staging_entries` row per source line. NO row MUST be inserted into `accounting_entries` (or any other Module 4 table) at parse time — the commit is a separate step that arrives in wave 2.

#### Scenario: CSV parsed into staging
- **WHEN** a 100-row BICICI CSV is parsed
- **THEN** `import_staging_entries` contains 100 rows linked to the `import_files.id`, each with `raw_columns` (JSONB), the mapped fields, and an empty `validation_errors` array if all checks pass

#### Scenario: Parse failure leaves a clean state
- **WHEN** the parser throws (e.g. malformed XLSX)
- **THEN** the `import_files.status` becomes `parse_failed`, `parse_error` carries the message, no staging rows are written, and `imports.file_parse_failed` is emitted

### Requirement: Column mapping is auto-proposed by header synonyms, overridable by the user

The system SHALL inspect the parsed file's headers, normalise them (lowercase, accents stripped, whitespace removed), and propose a `TargetField → sourceColumn` mapping using a fixed `HEADER_SYNONYMS` table (FR/EN — `date`, `libelle`, `compte`, `debit`, `credit`, `piece`, etc.). Unmatched required fields MUST surface as `ValidationError` per row at preview time, with `code: 'UNKNOWN_ACCOUNT'` / `'INVALID_DATE'` / etc.

#### Scenario: French headers match synonyms automatically
- **WHEN** a CSV has columns `Date opération | Libellé | Numéro compte | Débit | Crédit`
- **THEN** `MappingService.proposeMapping` returns `{ date: 'Date opération', label: 'Libellé', accountCode: 'Numéro compte', debit: 'Débit', credit: 'Crédit' }`

#### Scenario: Unknown header stays unmapped
- **WHEN** a CSV has a column `Référence client mémo` (no synonym)
- **THEN** that column appears in `unmappedSourceColumns` and the user must map it manually (UI wave 2)

### Requirement: Validation enforces accounting invariants per row

`ValidationService.validate` MUST surface (per row) every violation of:
- date is a parseable ISO-8601 or French `dd/mm/yyyy` date;
- at least one of `mapped_debit` / `mapped_credit` is set and > 0;
- `mapped_account_code` exists in the org's chart and has `account_type = 'POSTING'`;
- the `piece_ref` group (when present) has `sum(debit) === sum(credit)` ±0.01 XOF (rounding tolerance).

#### Scenario: Posting to a TITLE account is rejected
- **WHEN** a row maps to account code `41` (TITLE)
- **THEN** the row's `validation_errors` array contains `{ code: 'ACCOUNT_NOT_POSTING', accountCode: '41' }` and the row is NOT eligible for commit (wave 2)

#### Scenario: Unbalanced piece is flagged on every constituent row
- **WHEN** a piece `PI-001` has `sum(debit) = 100_000` and `sum(credit) = 95_000`
- **THEN** every row of `PI-001` carries `{ code: 'UNBALANCED_PIECE', pieceRef: 'PI-001', delta: 5000 }` in its `validation_errors`

### Requirement: Permissions matrix for imports

The catalogue MUST add `imports.read` and `imports.write`. The role × permission matrix MUST be:

| Role | imports.read | imports.write |
|---|:-:|:-:|
| admin | ✓ | ✓ |
| expert_comptable | ✓ | ✓ |
| chef_mission | ✓ | ✓ |
| comptable | ✓ | ✓ |
| auditeur | ✓ |  |
| client_readonly |  |  |

The `comptable` role intentionally HAS `imports.write` (mass data entry is their role); the gate against unauthorised commits to real accounting entries lives on the `commit` endpoint (wave 2), not on staging operations.

#### Scenario: Auditeur cannot upload
- **WHEN** an `auditeur` user attempts `POST /organizations/:id/imports/sessions`
- **THEN** the system responds `403 FORBIDDEN_PERMISSION`

#### Scenario: Comptable can upload
- **WHEN** a `comptable` user uploads a CSV to a draft session
- **THEN** the system responds `201`
