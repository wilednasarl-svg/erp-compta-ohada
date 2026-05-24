## ADDED Requirements

### Requirement: Journal entries enforce double-entry balance at three layers

A `JournalEntry` is valid if and only if `SUM(lines.debit) === SUM(lines.credit)`, computed to the cent on `DECIMAL(15,2)` values. The system MUST enforce this invariant at three layers, all of which MUST refuse an unbalanced entry:

1. **Service layer** (`EntriesService.createDraft`): computes the sum before any INSERT and surfaces `JOURNAL_ENTRY_UNBALANCED` (422) with `{ totalDebit, totalCredit, diff }` in `details`.
2. **PG trigger** (`tg_check_journal_entry_balance`): re-checks after every INSERT/UPDATE/DELETE on `journal_entry_lines`, RAISES an exception that rolls back the transaction.
3. **e2e test**: a direct `dataSource.query` INSERT that bypasses the service MUST trigger the trigger and fail.

#### Scenario: Unbalanced POST is rejected
- **WHEN** a caller submits `POST /organizations/:id/entries` with `lines: [{ account: 401, credit: 1000 }, { account: 6011, debit: 800 }]`
- **THEN** the system responds `422` with `{ error: { code: "JOURNAL_ENTRY_UNBALANCED", details: { totalDebit: 800, totalCredit: 1000, diff: -200 } } }` and writes nothing in `journal_entries` or `journal_entry_lines`

#### Scenario: Direct DB INSERT bypassing the service is caught by the trigger
- **WHEN** a developer runs `INSERT INTO journal_entry_lines (entry_id, debit, credit, ...) VALUES (..., 500, 0)` without inserting the matching credit line
- **THEN** the trigger `tg_check_journal_entry_balance` raises `EXCEPTION 'unbalanced entry: <id>'` and the surrounding transaction rolls back

### Requirement: Entry numbers are sequential per journal and immutable

Each `journals` row carries `next_entry_number INT NOT NULL DEFAULT 1`. On every `INSERT INTO journal_entries`, the service MUST atomically `UPDATE journals SET next_entry_number = next_entry_number + 1 RETURNING (next_entry_number - 1)` within the same transaction and write the returned number to `journal_entries.entry_number`. The `(organization_id, journal_id, entry_number)` UNIQUE constraint guarantees no duplicate.

`entry_number` is **immutable after creation**: no service method or endpoint may modify it. The DELETE path on `draft` entries decrements neither `next_entry_number` nor any other entry's number — gaps in the sequence are accepted as evidence that a draft was cancelled, but no two entries ever share a number.

#### Scenario: Sequential numbering across rapid creates
- **WHEN** three callers POST entries concurrently to journal `AC`
- **THEN** the three entries receive `entry_number` 1, 2, 3 (no gap, no duplicate) and `next_entry_number` advances to 4

#### Scenario: Draft deletion does not roll back the counter
- **WHEN** a user creates entry #5 (draft) and deletes it, then creates a new entry
- **THEN** the new entry receives `entry_number = 6` (not 5). Entry #5 is gone from the journal but the gap is intentional

### Requirement: Validated entries are immutable; correction requires reversal

Once an entry transitions `draft → validated`, every field except `description` (and the soft-deletion via cancellation) is immutable. The service MUST refuse `PATCH` or `DELETE` on a validated entry with `JOURNAL_ENTRY_IMMUTABLE` (409). The only way to correct a validated entry is `POST /entries/:id/cancel` which creates a new entry with inverted lines and links the two via `cancels` / `cancelled_by_id`.

#### Scenario: PATCH on validated entry is refused
- **WHEN** a user PATCHes a validated entry's `entryDate`
- **THEN** the system responds `409` with `{ error: { code: "JOURNAL_ENTRY_IMMUTABLE" } }`

#### Scenario: Cancellation produces a reverse entry
- **WHEN** a user cancels entry `E1` (debit 401:1000, credit 521:1000) with reason "wrong supplier"
- **THEN** the system creates entry `E2` (debit 521:1000, credit 401:1000), `E2.cancels = E1.id`, `E1.cancelled_by_id = E2.id`, `E1.status = 'cancelled'`, both `E1.cancelled_at` and `E2.validated_at` set to now()

### Requirement: Entry lines may only target POSTING accounts that are active

Each `JournalEntryLine.accountId` MUST reference an `organization_chart_accounts.id` whose `account_type = 'POSTING'` and `is_active = true`. The service rejects with `JOURNAL_ENTRY_NON_POSTING_ACCOUNT` (422) on a TITLE account, and `JOURNAL_ENTRY_INACTIVE_ACCOUNT` (422) on a deactivated POSTING. A PG trigger `tg_check_account_is_posting` re-checks at INSERT time.

#### Scenario: TITLE account rejected
- **WHEN** a user POSTs an entry with `lines: [{ accountCode: '40', debit: 500, ... }]` (40 is the TITLE class root)
- **THEN** the system responds `422` with `{ error: { code: "JOURNAL_ENTRY_NON_POSTING_ACCOUNT", details: { accountCode: '40', accountType: 'TITLE' } } }`

### Requirement: Entries cannot be posted in a closed period

The service MUST find the most-specific `AccountingPeriod` (MONTH > QUARTER > YEAR) containing the entry's `date` and refuse the create if `period.status = 'closed'`. The closure check runs on `createDraft` AND on `validate` (a draft created in an open period may have been left dangling when the period was closed — validation re-checks).

#### Scenario: POST in closed period
- **WHEN** the 2025-03 period is `closed` and a user POSTs an entry with `entryDate = '2025-03-15'`
- **THEN** the system responds `422` with `{ error: { code: "JOURNAL_ENTRY_PERIOD_CLOSED", details: { date, periodId, periodLabel } } }`

#### Scenario: Validating a draft after period was closed
- **WHEN** a draft created on 2025-03-10 still has status `draft` when 2025-03 is closed
- **THEN** the user attempting `POST /entries/:id/validate` receives `422 JOURNAL_ENTRY_PERIOD_CLOSED`; the draft remains and can be re-dated or deleted

### Requirement: Lettering reconciles balanced groups of lines on the same tiers account

`POST /organizations/:id/lettering` accepts `{ lineIds: string[] }`. The service:

1. Loads all lines, verifies they all belong to the same `account_id` (else 422 `LETTERING_DIFFERENT_ACCOUNTS`);
2. Verifies the account's `class = 4` (else 422 `LETTERING_CLASS_FORBIDDEN`);
3. Verifies `SUM(debit) === SUM(credit)` on the group (else 422 `LETTERING_UNBALANCED`);
4. Generates the next available letter for `(account_id, organization_id)` in the alphabet `AA..AZ..BA..ZZZ` (4-char ceiling);
5. UPDATEs `line_letter` atomically on all selected lines.

`POST /organizations/:id/lettering/unletter` with `{ accountId, letter }` clears `line_letter` for the matching set.

#### Scenario: Successful lettering on supplier 401
- **WHEN** a user letter-codes lines `[L1 (credit 401:1000), L2 (credit 401:200), L3 (debit 401:1200)]` (all on account 401)
- **THEN** the system assigns the next free letter (`AA`), updates all 3 lines, and returns `{ letter: 'AA', accountId, totalDebit: 1200, totalCredit: 1200 }`

### Requirement: Audit events are emitted on every state transition

Every state-changing operation MUST emit a row in `audit_logs` via `AuditTrailService.record({ module: 'journals', ... })`:

- `journals.entry_created` — `after = { entryId, journalCode, entryNumber, totalAmount, lineCount }`
- `journals.entry_validated` — `before = { status: 'draft' }, after = { status: 'validated', validatedBy }`
- `journals.entry_cancelled` — `before = { status: 'validated' }, after = { status: 'cancelled', cancelledByEntryId, reason }`
- `journals.letter_assigned` — `after = { accountId, letter, lineIds, totalAmount }`
- `journals.period_closed` — `before = { status: 'open' }, after = { status: 'closed', closedBy }`
- `journals.period_reopened` — `before = { status: 'closed' }, after = { status: 'open', reason, reopenedBy }`
- `journals.journal_created` — at org creation (5 standard journals) AND on custom journal creation

#### Scenario: Cancellation produces 2 audit rows
- **WHEN** entry E1 is cancelled
- **THEN** two rows land in `audit_logs`: `journals.entry_created` for the new reverse entry E2, AND `journals.entry_cancelled` for E1 (linked via metadata)
