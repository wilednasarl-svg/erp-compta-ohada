import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-AUDIT-10 (Module 7 — vague 1) — converge `auth_events` into the
 * unified audit log schema documented in `docs/produit/module-7-audit-trail.md`.
 *
 * Rationale
 * ---------
 * `auth_events` was introduced by 0010 as a narrow journal of
 * authentication and tenant-lifecycle events: a single `event_type` text
 * column plus a free-form `metadata` JSONB. Module 7 requires a generic
 * journal usable by every module (accounting, imports, transformations,
 * rules, workflows, reports, AI…). Rather than ship a second table and
 * fork the write paths, we extend `auth_events` in place so:
 *
 *   - all existing writers (Module 1 auth/org/MFA, Module 2 chart of
 *     accounts via `AuthEventsService`) keep working without code
 *     changes — `AuthEventRepository.record` is taught in BE-AUDIT-11
 *     to populate the new columns from the legacy `event_type` value;
 *   - the new generic `AuditTrailService.record({ module, action, ... })`
 *     writes through the same row shape, so a unified `GET /audit/logs`
 *     endpoint surfaces every emitter in one place.
 *
 * Column additions
 * ----------------
 *   - `module`        TEXT NOT NULL — first segment of the canonical
 *     event code (e.g. `auth`, `organizations`, `chart_of_accounts`,
 *     `imports`, `transformations`, `rules`, `workflows`, `reports`,
 *     `documents`, `ai`). Kept as plain TEXT rather than an enum so a
 *     downstream module can add a new module without a schema migration
 *     (the trade-off is documented in `docs/produit/audit-events.md`).
 *   - `action`        TEXT NOT NULL — remainder of the canonical code
 *     after the first `.` separator (e.g. `login_success`,
 *     `account_created`, `session_uploaded`). Free-form for the same
 *     reason as `module`.
 *   - `entity_type`   TEXT NULL — type of the business entity touched
 *     by the action (`organization`, `account`, `import_session`,
 *     `rule`…). NULL for events that have no single target (e.g.
 *     `auth.login_failed` on an unknown email).
 *   - `entity_id`     UUID NULL — id of that entity. Stored as UUID
 *     because every Module 1/2 primary key is a UUID; modules that
 *     reference a non-UUID id (rare — file paths, external refs) MUST
 *     stash it in `metadata` instead.
 *   - `before`        JSONB NULL — pre-mutation snapshot (only the
 *     fields that changed, NOT the full row). NULL for create / read
 *     events and for events with no diff semantics (auth login etc).
 *   - `after`         JSONB NULL — post-mutation snapshot, same
 *     contract as `before`.
 *   - `request_id`    TEXT NULL — correlation id from
 *     `RequestContext.requestId` (BE-BOOT-09). Captured so audit and
 *     pino logs can be cross-joined on a single value.
 *
 * Back-compat
 * -----------
 *   - `event_type` is preserved as the legacy "module.action" tuple.
 *     Going forward, writers populate both `event_type` AND
 *     (`module`, `action`) so old readers (the `AuthEventsController`
 *     under `/organizations/:id/auth-events`) keep working unchanged.
 *   - Existing rows are backfilled in a single UPDATE that splits
 *     `event_type` on the first `.` (events that lack a separator land
 *     in `module = '_legacy'` so the NOT NULL constraint holds).
 *   - Old indexes are kept; new composite indexes cover the
 *     Module 7 read patterns (`/audit/logs` filtered by module, by
 *     module+action, by entity).
 *
 * Idempotency
 * -----------
 * `IF NOT EXISTS` on every new column and index, so a replay against
 * a partially-migrated DB is safe. The `down()` reverses additions in
 * the inverse order without dropping data from the legacy columns.
 */
export class ExtendAuthEventsToAuditLogs1700000000019 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. New columns — all nullable for the initial ADD so the backfill
    //    can run without violating constraints; `module`/`action` get
    //    flipped to NOT NULL at the end.
    await queryRunner.query(`
      ALTER TABLE "auth_events"
        ADD COLUMN IF NOT EXISTS "module"      TEXT  NULL,
        ADD COLUMN IF NOT EXISTS "action"      TEXT  NULL,
        ADD COLUMN IF NOT EXISTS "entity_type" TEXT  NULL,
        ADD COLUMN IF NOT EXISTS "entity_id"   UUID  NULL,
        ADD COLUMN IF NOT EXISTS "before"      JSONB NULL,
        ADD COLUMN IF NOT EXISTS "after"       JSONB NULL,
        ADD COLUMN IF NOT EXISTS "request_id"  TEXT  NULL
    `);

    // 2. Backfill `module` / `action` from the legacy `event_type` for
    //    every row that doesn't have them yet (so replays don't churn
    //    rows that a later write already populated correctly).
    //    `split_part(event_type, '.', 1)` returns the whole string when
    //    there is no '.', which is exactly what we want for the
    //    fallback path (the second split_part then returns '' and we
    //    coalesce it to '_unspecified').
    await queryRunner.query(`
      UPDATE "auth_events"
      SET
        "module" = CASE
          WHEN position('.' IN "event_type") > 0
            THEN split_part("event_type", '.', 1)
          ELSE '_legacy'
        END,
        "action" = CASE
          WHEN position('.' IN "event_type") > 0
            THEN substring("event_type" FROM position('.' IN "event_type") + 1)
          ELSE COALESCE(NULLIF("event_type", ''), '_unspecified')
        END
      WHERE "module" IS NULL OR "action" IS NULL
    `);

    // 3. Flip the new columns to NOT NULL now that every row is
    //    backfilled. Wrapped in DO blocks so a re-run doesn't fail
    //    when the constraint is already in place.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'auth_events' AND column_name = 'module' AND is_nullable = 'YES'
        ) THEN
          ALTER TABLE "auth_events" ALTER COLUMN "module" SET NOT NULL;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'auth_events' AND column_name = 'action' AND is_nullable = 'YES'
        ) THEN
          ALTER TABLE "auth_events" ALTER COLUMN "action" SET NOT NULL;
        END IF;
      END $$
    `);

    // 4. Indexes tuned for the new read patterns surfaced by
    //    `GET /audit/logs`:
    //      - "show me every event in module X for org O, newest first"
    //      - "show me every X.Y action for org O, newest first"
    //      - "show me the history of one specific entity (org O, type T,
    //         id I)"
    //    Each index is (organization_id, …, created_at DESC) so a sort
    //    + limit can be served from the index without a heap sort.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_auth_events_org_module_created_at"
       ON "auth_events" ("organization_id", "module", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_auth_events_org_module_action_created_at"
       ON "auth_events" ("organization_id", "module", "action", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_auth_events_org_entity_created_at"
       ON "auth_events" ("organization_id", "entity_type", "entity_id", "created_at" DESC)
       WHERE "entity_type" IS NOT NULL AND "entity_id" IS NOT NULL`,
    );

    // 5. `audit.read` already exists from 0005 (auth_events viewer);
    //    Module 7 uses the same permission code so the new
    //    `/audit/logs` route inherits the role attachments without a
    //    new permissions migration. Document the reuse here so a
    //    future maintainer doesn't add a duplicate `audit.logs.read`.

    // 6. A short column comment for future archaeology.
    await queryRunner.query(`
      COMMENT ON COLUMN "auth_events"."module" IS
        'Module 7 — first segment of event_type. Kept TEXT to let new modules extend the catalog without a schema migration.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "auth_events"."action" IS
        'Module 7 — remainder of event_type after the first dot.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_auth_events_org_entity_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_auth_events_org_module_action_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_auth_events_org_module_created_at"`);
    await queryRunner.query(`
      ALTER TABLE "auth_events"
        DROP COLUMN IF EXISTS "request_id",
        DROP COLUMN IF EXISTS "after",
        DROP COLUMN IF EXISTS "before",
        DROP COLUMN IF EXISTS "entity_id",
        DROP COLUMN IF EXISTS "entity_type",
        DROP COLUMN IF EXISTS "action",
        DROP COLUMN IF EXISTS "module"
    `);
  }
}
