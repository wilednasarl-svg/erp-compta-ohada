# cleanup-smoke-prod.sql — runbook

## Why

Three smoke-test scripts (`smoke-imports-module-3.mjs`,
`smoke-imports-commit.mjs`, `smoke-offset-fiscal-year.mjs`) created
throwaway data directly in the Supabase **prod** DB using accounts on
`smoke-{type}-{timestamp}@example.com`. The `@example.com` TLD is
reserved by RFC 2606 and cannot belong to a real customer, so it is a
100 % safe filter to anchor cleanup on.

## Step 1 — Dry run (no commit)

1. Open the Supabase SQL editor (or any psql against prod).
2. Paste the full contents of `cleanup-smoke-prod.sql`.
3. Run as-is. The script is wrapped in `BEGIN ... ROLLBACK;`, and the
   three `DELETE` statements are commented out — **nothing** is written.
4. Read the result of the `SELECT` in step 3. You should see, roughly:
   - `smoke_users`: ~24 (≈ 8 runs × 3 scripts)
   - `smoke_orgs`: ~24 (one org per smoke user)
   - `memberships`: ~24
   - `journal_entries`: in the thousands (≈ 8 runs × ~800 lines for
     `smoke-imports-commit`)
   - `journal_entry_lines`: ~2× `journal_entries` (double-entry)
   - `import_sessions` / `import_files` / `import_staging_entries`:
     small but non-zero
   - `auth_events (org-scoped)` and `auth_events (user-scoped)`: dozens
     per smoke account
5. **Validate**: every count is non-zero only on rows we expect to
   purge. If you see a suspiciously large number on a table you did not
   expect, STOP and investigate before going further.

## Step 2 — Commit

Once the counts look right:

1. In `cleanup-smoke-prod.sql`, uncomment:
   - the `DELETE FROM auth_events ...` block (step 4)
   - the `DELETE FROM organizations ...` block (step 5)
   - the `DELETE FROM users ...` block (step 6)
2. Replace the trailing `ROLLBACK;` with `COMMIT;`.
3. Re-run the whole script. Capture the output.

## Step 3 — Verify

In a **fresh** transaction (don't reuse the temp tables from step 2):

```sql
SELECT COUNT(*) AS smoke_users_remaining
FROM users
WHERE email LIKE 'smoke-%@example.com';
```

Expected: `0`.

Sanity-check the org table too:

```sql
SELECT COUNT(*) AS smoke_orgs_remaining
FROM organizations o
WHERE EXISTS (
  SELECT 1 FROM memberships m
  JOIN users u ON u.id = m.user_id
  WHERE m.organization_id = o.id
    AND u.email LIKE 'smoke-%@example.com'
);
```

Expected: `0`.

## Notes

- One-shot script. Do **not** add it to a migration — schema is
  unchanged.
- The smoke scripts in `apps/backend/scripts/smoke-*.mjs` should be
  pointed at staging in future runs to avoid recreating residue.
