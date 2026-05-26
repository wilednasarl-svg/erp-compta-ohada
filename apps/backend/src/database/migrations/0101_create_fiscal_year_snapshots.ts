import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * d17.24 — Snapshots pluri-exercices (W5.5).
 *
 * Fige les chiffres officiels d'un exercice clôturé (Bilan, Compte de
 * résultat, SIG, TFT) pour servir de base de comparaison N/N-1 dans la
 * liasse SYSCOHADA. Sans ce snapshot, la colonne "N-1" du Bilan et du
 * CR serait recalculée à la volée depuis le grand livre — ce qui peut
 * diverger si des écritures correctives sont passées rétroactivement
 * sur l'exercice clos (corrections de section sociale, contrôles
 * fiscaux, etc.).
 *
 * Une seule ligne ACTIVE par (org, exercise, snapshot_type). Re-fixer
 * un snapshot = appender une nouvelle ligne et marquer la précédente
 * `superseded_at`. L'historique est append-only (compatible avec la
 * doctrine d'intangibilité OHADA article 17 AUDCIF).
 *
 *   - `snapshot_type` : code stable. Wave 1 : 'BILAN' | 'PROFIT_LOSS' |
 *     'SIG' | 'TFT'. Wave 2 (W5.5.b) : ajout 'NOTES' pour fixer les
 *     notes annexes complètes.
 *   - `payload`        : JSONB. Structure libre par snapshot_type, le
 *     consommateur la cast en `BalanceSheetReport` / `ProfitLossReport`
 *     / `SigReport` / `TftReport`.
 *   - `taken_at`       : horodatage de l'opération de fige.
 *   - `taken_by_id`    : user qui a déclenché la fige (audit trail).
 *   - `superseded_at`  : `NULL` tant que c'est le snapshot actif.
 *     Une fois superseded, ne plus jamais retoucher la ligne.
 */
export class CreateFiscalYearSnapshots1700000000101 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "fiscal_year_snapshots" (
        "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" UUID       NOT NULL,
        "exercise_id"    UUID        NOT NULL,
        "snapshot_type"  TEXT        NOT NULL,
        "payload"        JSONB       NOT NULL,
        "taken_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "taken_by_id"    UUID,
        "superseded_at"  TIMESTAMPTZ,
        CONSTRAINT "pk_fiscal_year_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "fk_fiscal_year_snapshots_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_fiscal_year_snapshots_exercise"
          FOREIGN KEY ("exercise_id")
          REFERENCES "accounting_periods" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fiscal_year_snapshots_type"
          CHECK ("snapshot_type" IN ('BILAN', 'PROFIT_LOSS', 'SIG', 'TFT'))
      )
    `);

    // Recherche typique : "donne-moi le snapshot ACTIF d'un type pour
    // un exercice donné". Index partiel sur superseded_at IS NULL pour
    // garantir l'unicité du snapshot actif par (org, exercise, type).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_fiscal_year_snapshots_active"
        ON "fiscal_year_snapshots" ("organization_id", "exercise_id", "snapshot_type")
        WHERE "superseded_at" IS NULL
    `);

    // Index couvrant pour l'historique audit.
    await queryRunner.query(`
      CREATE INDEX "ix_fiscal_year_snapshots_history"
        ON "fiscal_year_snapshots" ("organization_id", "exercise_id", "snapshot_type", "taken_at" DESC)
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "fiscal_year_snapshots"
        IS 'W5.5 — fige les chiffres officiels d''un exercice (Bilan, CR, SIG, TFT) pour servir de base N-1 dans la liasse SYSCOHADA. Append-only.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "fiscal_year_snapshots"."payload"
        IS 'JSONB libre — structure dépend de snapshot_type. Le consommateur cast en BalanceSheetReport / ProfitLossReport / SigReport / TftReport.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "fiscal_year_snapshots"`);
  }
}
