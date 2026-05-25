-- =====================================================================
-- cleanup-smoke-prod.sql — one-shot cleanup of smoke-test residue
-- =====================================================================
--
-- Context
-- -------
-- Three smoke-test scripts created data directly in the Supabase prod DB
-- using throwaway accounts on the RFC 2606 reserved domain @example.com:
--
--   apps/backend/scripts/smoke-imports-module-3.mjs
--   apps/backend/scripts/smoke-imports-commit.mjs
--   apps/backend/scripts/smoke-offset-fiscal-year.mjs
--
-- Every account they create matches the pattern:
--   smoke-{type}-{timestamp}@example.com
--
-- The @example.com TLD is reserved (RFC 2606) and therefore CANNOT match
-- any real customer email — this is the 100% safe filter we anchor on.
--
-- Strategy
-- --------
-- 1. Collect smoke users (smoke-%@example.com).
-- 2. Collect the organizations linked to those users via memberships.
-- 3. DELETE FROM organizations → cascades to almost everything:
--      memberships, organization_accounting_configs,
--      organization_chart_accounts, import_sessions
--      (→ import_files → import_staging_entries),
--      accounting_periods, journals, journal_entries
--      (→ journal_entry_lines), documents, document_entries,
--      rules, rule_executions, entry_transformations,
--      partner_letterings, tva_codes, tva_declarations
--      (→ tva_declaration_lines), assets, depreciation_schedules,
--      entry_signatures, currencies, exchange_rates,
--      inventory_items, inventory_movements, bank_accounts
--      (→ bank_statements → bank_statement_lines, bank_reconciliation_matches),
--      ai_anomalies, collaboration_requests, collaboration_comments,
--      accounting_scores, refresh_tokens, invitations.
-- 4. Explicitly clean `auth_events` rows pointing at the targeted orgs
--    BEFORE we DELETE the orgs / users: the FK is ON DELETE SET NULL
--    (orphan rows would otherwise pollute the audit trail with
--    unattributable smoke events).
-- 5. DELETE FROM users → cascades refresh_tokens / mfa_configs /
--    memberships (already gone). `auth_events.user_id` is also
--    ON DELETE SET NULL — handled in step 4.
--
-- FK CASCADE audit (relevant subset)
-- ----------------------------------
--   memberships.organization_id              CASCADE         OK
--   memberships.user_id                      CASCADE         OK
--   refresh_tokens.user_id                   CASCADE         OK
--   refresh_tokens.organization_id           CASCADE         OK
--   organization_accounting_configs.org_id   CASCADE         OK
--   organization_chart_accounts.org_id       CASCADE         OK
--   import_sessions.organization_id          CASCADE         OK
--   import_files.session_id                  CASCADE         OK
--   import_staging_entries.session_id        CASCADE         OK
--   import_staging_entries.file_id           CASCADE         OK
--   accounting_periods.organization_id       CASCADE         OK
--   journals.organization_id                 CASCADE         OK
--   journal_entries.organization_id          CASCADE         OK
--   journal_entry_lines.journal_entry_id     CASCADE         OK
--   journal_entry_lines.organization_id      CASCADE         OK
--   auth_events.organization_id              SET NULL  <---  HANDLED in step 4
--   auth_events.user_id                      SET NULL  <---  HANDLED in step 4
--
-- Usage
-- -----
-- Run inside Supabase SQL editor (or psql) AS-IS first — the BEGIN /
-- ROLLBACK envelope means nothing is actually committed; the SELECT
-- COUNT statements give you the audit numbers.
--
-- Once the numbers look right:
--   1) Uncomment the two DELETE statements (steps 5 and 6).
--   2) Replace the trailing `ROLLBACK;` with `COMMIT;`.
--   3) Re-run.
--   4) Re-run the SELECT COUNTs from step 3 alone (in a fresh transaction)
--      to confirm everything is at 0.
--
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Step 1: collect smoke users (RFC 2606 reserved domain → 100 % safe)
-- ---------------------------------------------------------------------
CREATE TEMP TABLE smoke_users ON COMMIT DROP AS
SELECT id, email
FROM users
WHERE email LIKE 'smoke-%@example.com';

-- ---------------------------------------------------------------------
-- Step 2: collect the orgs those users own / belong to
-- ---------------------------------------------------------------------
CREATE TEMP TABLE smoke_orgs ON COMMIT DROP AS
SELECT DISTINCT m.organization_id AS id
FROM memberships m
WHERE m.user_id IN (SELECT id FROM smoke_users);

-- ---------------------------------------------------------------------
-- Step 3: audit counts BEFORE delete (dry-run output)
-- ---------------------------------------------------------------------
SELECT 'smoke_users'                  AS table_name, COUNT(*) AS rows FROM smoke_users
UNION ALL SELECT 'smoke_orgs',               COUNT(*) FROM smoke_orgs
UNION ALL SELECT 'memberships',              COUNT(*) FROM memberships              WHERE organization_id IN (SELECT id FROM smoke_orgs)
UNION ALL SELECT 'refresh_tokens',           COUNT(*) FROM refresh_tokens           WHERE user_id IN (SELECT id FROM smoke_users)
UNION ALL SELECT 'organization_accounting_configs',
                                              COUNT(*) FROM organization_accounting_configs WHERE organization_id IN (SELECT id FROM smoke_orgs)
UNION ALL SELECT 'organization_chart_accounts',
                                              COUNT(*) FROM organization_chart_accounts WHERE organization_id IN (SELECT id FROM smoke_orgs)
UNION ALL SELECT 'import_sessions',          COUNT(*) FROM import_sessions          WHERE organization_id IN (SELECT id FROM smoke_orgs)
UNION ALL SELECT 'import_files',             COUNT(*) FROM import_files             WHERE session_id IN (SELECT id FROM import_sessions WHERE organization_id IN (SELECT id FROM smoke_orgs))
UNION ALL SELECT 'import_staging_entries',   COUNT(*) FROM import_staging_entries   WHERE session_id IN (SELECT id FROM import_sessions WHERE organization_id IN (SELECT id FROM smoke_orgs))
UNION ALL SELECT 'accounting_periods',       COUNT(*) FROM accounting_periods       WHERE organization_id IN (SELECT id FROM smoke_orgs)
UNION ALL SELECT 'journals',                 COUNT(*) FROM journals                 WHERE organization_id IN (SELECT id FROM smoke_orgs)
UNION ALL SELECT 'journal_entries',          COUNT(*) FROM journal_entries          WHERE organization_id IN (SELECT id FROM smoke_orgs)
UNION ALL SELECT 'journal_entry_lines',      COUNT(*) FROM journal_entry_lines      WHERE organization_id IN (SELECT id FROM smoke_orgs)
UNION ALL SELECT 'auth_events (org-scoped)', COUNT(*) FROM auth_events              WHERE organization_id IN (SELECT id FROM smoke_orgs)
UNION ALL SELECT 'auth_events (user-scoped)',COUNT(*) FROM auth_events              WHERE user_id IN (SELECT id FROM smoke_users)
ORDER BY table_name;

-- ---------------------------------------------------------------------
-- Step 4: nullify (or delete) the audit log rows that point at the
-- smoke orgs / users. FK is ON DELETE SET NULL, but a SET NULL would
-- leave dangling audit rows. We DELETE them instead — they describe
-- throwaway accounts that should not appear in the audit trail.
-- ---------------------------------------------------------------------
-- DELETE FROM auth_events
-- WHERE organization_id IN (SELECT id FROM smoke_orgs)
--    OR user_id         IN (SELECT id FROM smoke_users);

-- ---------------------------------------------------------------------
-- Step 5: DELETE the orgs. Everything CASCADE-linked goes with them.
-- ---------------------------------------------------------------------
-- DELETE FROM organizations
-- WHERE id IN (SELECT id FROM smoke_orgs);

-- ---------------------------------------------------------------------
-- Step 6: DELETE the smoke users. Their refresh_tokens / mfa_configs
-- CASCADE on user_id; auth_events.user_id is SET NULL but already
-- handled in step 4.
-- ---------------------------------------------------------------------
-- DELETE FROM users
-- WHERE id IN (SELECT id FROM smoke_users);

-- ---------------------------------------------------------------------
-- DRY-RUN: keep ROLLBACK for inspection. Switch to COMMIT only after
-- uncommenting steps 4-6 above and reviewing the audit counts.
-- ---------------------------------------------------------------------
ROLLBACK;
-- COMMIT;
