import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-AI-01 — `ai_anomalies` : anomalies détectées sur le GL.
 *
 * Une ligne par (entry × type) ou (account × type) pour les anomalies
 * agrégées. L'unicité partielle permet UPSERT atomique sans wipe.
 * Migration idempotente : IF NOT EXISTS partout.
 */
export class CreateAiAnomalies1700000000076 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_anomalies" (
        "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID         NOT NULL,
        "period_id"        UUID,
        "entry_id"         UUID,
        "account_id"       UUID,
        "anomaly_type"     TEXT         NOT NULL,
        "risk_score"       INTEGER      NOT NULL,
        "reasons"          JSONB        NOT NULL DEFAULT '[]'::jsonb,
        "detected_by"      TEXT         NOT NULL DEFAULT 'heuristic_v1',
        "detected_at"      TIMESTAMPTZ  NOT NULL,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_anomalies" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_anomalies_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ai_anomalies_period"
          FOREIGN KEY ("period_id")
          REFERENCES "accounting_periods" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ai_anomalies_entry"
          FOREIGN KEY ("entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ai_anomalies_account"
          FOREIGN KEY ("account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_ai_anomalies_type"
          CHECK ("anomaly_type" IN (
            'extreme_amount',
            'sensitive_account',
            'potential_duplicate',
            'suspicious_date',
            'rare_account_journal'
          )),
        CONSTRAINT "chk_ai_anomalies_risk_score"
          CHECK ("risk_score" BETWEEN 0 AND 100),
        CONSTRAINT "chk_ai_anomalies_target_present"
          CHECK ("entry_id" IS NOT NULL OR "account_id" IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_ai_anomalies_org_period"
        ON "ai_anomalies" ("organization_id", "period_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_ai_anomalies_org_score"
        ON "ai_anomalies" ("organization_id", "risk_score")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_ai_anomalies_org_type"
        ON "ai_anomalies" ("organization_id", "anomaly_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_ai_anomalies_entry"
        ON "ai_anomalies" ("entry_id")
        WHERE "entry_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_ai_anomalies_account"
        ON "ai_anomalies" ("account_id")
        WHERE "account_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_anomalies_org_entry_type"
        ON "ai_anomalies" ("organization_id", "entry_id", "anomaly_type")
        WHERE "entry_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_anomalies_org_account_type"
        ON "ai_anomalies" ("organization_id", "account_id", "anomaly_type")
        WHERE "entry_id" IS NULL AND "account_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_anomalies"`);
  }
}
