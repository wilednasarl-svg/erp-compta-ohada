import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-JE-04 — `journal_entry_lines` : lignes débit/crédit d'une écriture.
 *
 * Chaque ligne mouvemente UN compte du plan comptable de l'organisation,
 * EXACTEMENT d'un seul côté (débit OU crédit, jamais les deux non nuls
 * sur la même ligne — règle SYSCOHADA).
 *
 *   - `account_id`   : FK vers `organization_chart_accounts`. RESTRICT
 *     pour empêcher la suppression d'un compte mouvementé.
 *   - `debit`        : DECIMAL(15,2) — montant débit, 0 si crédit.
 *   - `credit`       : DECIMAL(15,2) — montant crédit, 0 si débit.
 *   - `position`     : index 1-based pour conserver l'ordre des lignes
 *     tel que l'utilisateur les a saisies.
 *   - `line_letter`  : VARCHAR(4) NULL — pour le lettrage (réconciliation
 *     tiers — vague 2).
 *
 * Contraintes :
 *   - CHECK exactement-un-côté : (debit > 0 AND credit = 0) OR
 *     (debit = 0 AND credit > 0).
 *   - CHECK montants positifs.
 *
 * L'invariant d'équilibre `SUM(debit) = SUM(credit)` par entry est
 * vérifié côté service (`EntriesService.createDraft`) et garantit
 * une UX claire avant tout INSERT.
 */
export class CreateJournalEntryLines1700000000039 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "journal_entry_lines" (
        "id"                  UUID           NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"     UUID           NOT NULL,
        "journal_entry_id"    UUID           NOT NULL,
        "account_id"          UUID           NOT NULL,
        "position"            INTEGER        NOT NULL,
        "description"         TEXT,
        "debit"               DECIMAL(15, 2) NOT NULL DEFAULT 0,
        "credit"              DECIMAL(15, 2) NOT NULL DEFAULT 0,
        "line_letter"         VARCHAR(4),
        "created_at"          TIMESTAMPTZ    NOT NULL DEFAULT now(),
        CONSTRAINT "pk_journal_entry_lines" PRIMARY KEY ("id"),
        CONSTRAINT "fk_journal_entry_lines_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_journal_entry_lines_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_journal_entry_lines_account"
          FOREIGN KEY ("account_id")
          REFERENCES "organization_chart_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_journal_entry_lines_exactly_one_side"
          CHECK (
            ("debit" > 0 AND "credit" = 0)
            OR ("debit" = 0 AND "credit" > 0)
          ),
        CONSTRAINT "chk_journal_entry_lines_positive_amounts"
          CHECK ("debit" >= 0 AND "credit" >= 0),
        CONSTRAINT "chk_journal_entry_lines_position_positive"
          CHECK ("position" >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_journal_entry_lines_entry_position"
        ON "journal_entry_lines" ("journal_entry_id", "position")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_journal_entry_lines_org_account"
        ON "journal_entry_lines" ("organization_id", "account_id")
    `);

    // Index partiel pour les requêtes de lettrage (vague 2)
    await queryRunner.query(`
      CREATE INDEX "ix_journal_entry_lines_org_account_letter"
        ON "journal_entry_lines" ("organization_id", "account_id", "line_letter")
        WHERE "line_letter" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "journal_entry_lines"`);
  }
}
