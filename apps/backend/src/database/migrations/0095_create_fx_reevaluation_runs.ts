import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * M16 wave 3.4 — Réévaluation FX à la clôture d'exercice (article 54 AU).
 *
 * Table `fx_reevaluation_runs` : trace l'exécution annuelle de la
 * réévaluation des créances et dettes en devise étrangère à la date
 * de clôture, ainsi que la contre-passation au 01/01 N+1.
 *
 * Doctrine : à la clôture, l'écart entre la valeur historique (taux
 * d'origine) et la valeur recalculée au taux de clôture est comptabilisé
 * dans les comptes 478x (pertes latentes, écarts de conversion actif)
 * ou 479x (gains latents, écarts de conversion passif). La contrepartie
 * est portée sur le compte de tiers ou de trésorerie concerné. L'écriture
 * est extournée intégralement au 1er jour de l'exercice suivant pour
 * réafficher le solde à sa valeur historique.
 *
 * Une seule run par (organisation, date de clôture) — l'unicité empêche
 * deux réévaluations concurrentes sur le même bilan. `metadata` JSONB
 * stocke le détail par compte (taux, soldes, écart calculé) pour audit.
 */
export class CreateFxReevaluationRuns1700000000095 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fx_reevaluation_runs" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" UUID NOT NULL,
        "closing_date" DATE NOT NULL,
        "reversal_date" DATE NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "executed_at" TIMESTAMPTZ NULL,
        "executed_by_id" UUID NULL,
        "reversed_at" TIMESTAMPTZ NULL,
        "journal_entry_id" UUID NULL,
        "reversal_journal_entry_id" UUID NULL,
        "metadata" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "error_message" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fx_reevaluation_runs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_fx_reevaluation_runs_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_fx_reevaluation_runs_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_fx_reevaluation_runs_reversal_entry"
          FOREIGN KEY ("reversal_journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_fx_reevaluation_runs_executed_by"
          FOREIGN KEY ("executed_by_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "ck_fx_reevaluation_runs_status"
          CHECK ("status" IN ('pending', 'executed', 'reversed', 'failed'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_fx_reevaluation_runs_org_closing"
        ON "fx_reevaluation_runs" ("organization_id", "closing_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_fx_reevaluation_runs_org_status"
        ON "fx_reevaluation_runs" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_fx_reevaluation_runs_closing_date"
        ON "fx_reevaluation_runs" ("closing_date")
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "fx_reevaluation_runs"
        IS 'M16 W3.4 — réévaluation FX clôture (art. 54 AU) + contre-passation N+1.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "fx_reevaluation_runs"."metadata"
        IS 'Détail JSONB par compte évalué : accountCode, originalCurrency, originalRate, closingRate, originalAmountCurrency, recalculatedAmount, ecart. Audit-only.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_fx_reevaluation_runs_closing_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_fx_reevaluation_runs_org_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_fx_reevaluation_runs_org_closing"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fx_reevaluation_runs"`);
  }
}
