## MODIFIED Requirements

### Requirement: A chart account that has been posted to cannot be promoted or deleted

The Module 2 design (D4) promised that a `POSTING` account which had already been posted to (`JournalEntryLine.account_id` references it) could not be promoted to `TITLE` by adding a child under it, AND could not be deleted. Module 2 shipped the deletion guard (custom + leaf only). Module 4 closes the loop by adding the **posting-history** check:

- `ChartOfAccountsService.createCustomAccount` MUST verify the parent has no validated `JournalEntryLine` before promoting `POSTING → TITLE`. If it does, refuse with `CHART_ACCOUNT_HAS_POSTINGS` (409).
- `ChartOfAccountsService.deleteAccount` MUST verify the account has no validated `JournalEntryLine` even if it is custom and leaf. If it does, refuse with `CHART_ACCOUNT_HAS_POSTINGS` (409) (replacing the existing `CHART_ACCOUNT_NOT_DELETABLE` mapping for this specific branch).

#### Scenario: Promoting a posted-to account is refused
- **WHEN** account `4111` is `POSTING`, has one validated `JournalEntryLine`, and an admin POSTs a sub-account `41110001` under it
- **THEN** the system responds `409` with `{ error: { code: "CHART_ACCOUNT_HAS_POSTINGS", details: { accountId, postingCount } } }` and does not create the sub-account

#### Scenario: Deleting a posted-to custom account is refused
- **WHEN** a custom account `41100099` has at least one validated line and a user attempts DELETE
- **THEN** the system responds `409` with `{ error: { code: "CHART_ACCOUNT_HAS_POSTINGS" } }`. The account remains, the lines remain. The user's options are: deactivate the account (`PATCH isActive: false`) or cancel the validated entries (which still leaves the lines in the audit trail).
