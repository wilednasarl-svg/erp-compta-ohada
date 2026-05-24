import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-JE-01 — `accounting_periods` : périodes comptables d'une organisation.
 *
 * Hiérarchie matérialisée par `parent_id` :
 *   - une `ANNUAL` est racine (parent_id NULL)
 *   - une `QUARTERLY` ou `MONTHLY` pointe vers son ANNUAL parent
 *
 * Clôture en cascade : clôturer une ANNUAL clôture ses enfants (logique
 * applicative, pas un trigger PG — voir `PeriodsService.closePeriod`).
 *
 *   - `start_date` / `end_date` : bornes inclusives.
 *   - `kind`                    : ANNUAL | QUARTERLY | MONTHLY.
 *   - `status`                  : open | closed. Aucune écriture ne peut
 *     être enregistrée avec date dans une période `closed`.
 *   - `closed_at` / `closed_by` : audit applicatif (en plus du journal
 *     `journals.period_closed`).
 *   - `reopened_reason`         : obligatoire si on réouvre une période
 *     déjà clôturée (audit + responsabilisation).
 *
 * Contraintes :
 *   - UNIQUE (organization_id, kind, start_date) — empêche deux mensuelles
 *     "janvier 2026" pour la même org.
 *   - CHECK kind ∈ ('ANNUAL', 'QUARTERLY', 'MONTHLY')
 *   - CHECK status ∈ ('open', 'closed')
 *   - CHECK end_date > start_date
 *   - CHECK (status = 'closed' AND closed_at IS NOT NULL) OR (status = 'open' AND closed_at IS NULL)
 */
export class CreateAccountingPeriods1700000000036 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "accounting_periods" (
        "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID        NOT NULL,
        "parent_id"        UUID,
        "kind"             TEXT        NOT NULL,
        "label"            TEXT        NOT NULL,
        "start_date"       DATE        NOT NULL,
        "end_date"         DATE        NOT NULL,
        "status"           TEXT        NOT NULL DEFAULT 'open',
        "closed_at"        TIMESTAMPTZ,
        "closed_by"        UUID,
        "reopened_reason"  TEXT,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_accounting_periods" PRIMARY KEY ("id"),
        CONSTRAINT "fk_accounting_periods_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_accounting_periods_parent"
          FOREIGN KEY ("parent_id")
          REFERENCES "accounting_periods" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_accounting_periods_org_kind_start"
          UNIQUE ("organization_id", "kind", "start_date"),
        CONSTRAINT "chk_accounting_periods_kind"
          CHECK ("kind" IN ('ANNUAL', 'QUARTERLY', 'MONTHLY')),
        CONSTRAINT "chk_accounting_periods_status"
          CHECK ("status" IN ('open', 'closed')),
        CONSTRAINT "chk_accounting_periods_dates"
          CHECK ("end_date" > "start_date"),
        CONSTRAINT "chk_accounting_periods_closed_coherence"
          CHECK (
            ("status" = 'closed' AND "closed_at" IS NOT NULL)
            OR ("status" = 'open' AND "closed_at" IS NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_accounting_periods_org_status"
        ON "accounting_periods" ("organization_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_accounting_periods_org_dates"
        ON "accounting_periods" ("organization_id", "start_date", "end_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "accounting_periods"`);
  }
}
