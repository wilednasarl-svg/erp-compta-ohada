import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * M9 wave 3.4 — Axes analytiques (Option A) sur `journal_entry_lines`.
 *
 * Suite à la décision utilisateur (2026-05-26), implémentation Option A
 * (1 axe par ligne) pour le reporting analytique sans multi-société :
 *
 *   - `analytic_axis_type` : VARCHAR(30) NULL — type d'axe (ex. CHANTIER,
 *     BU, ACTIVITE, PROJET). Convention : majuscules, ascii uniquement.
 *   - `analytic_axis_code` : VARCHAR(50) NULL — code de l'axe lui-même
 *     (ex. AB123, BETON, RTE-MAN-2026). Convention : alphanumérique +
 *     tirets, majuscules par convention mais non imposé.
 *
 * Les deux colonnes sont nullable. Une ligne sans imputation analytique
 * laisse les deux à NULL. Une ligne imputée doit renseigner les deux
 * (le service applicatif vérifie l'invariant `(type IS NULL) =
 * (code IS NULL)` — pas de contrainte SQL pour rester souple côté import).
 *
 * Index composite `(organization_id, analytic_axis_type, analytic_axis_code)`
 * pour servir efficacement les requêtes "balance par chantier" et
 * "marge par activité" sans full scan.
 *
 * Ne change rien au comportement existant des rapports : tous les
 * filtres analytiques sont OPTIONNELS et restent à NULL par défaut.
 */
export class AddAnalyticAxes1700000000092 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        ADD COLUMN IF NOT EXISTS "analytic_axis_type" VARCHAR(30) NULL,
        ADD COLUMN IF NOT EXISTS "analytic_axis_code" VARCHAR(50) NULL
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "journal_entry_lines"."analytic_axis_type"
        IS 'Type de l''axe analytique (CHANTIER, BU, ACTIVITE, PROJET, ...). '
        || 'NULL si la ligne n''est pas imputée analytiquement. Migration 0092.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "journal_entry_lines"."analytic_axis_code"
        IS 'Code de l''axe analytique (ex. CHANTIER AB123). NULL si la ligne '
        || 'n''est pas imputée. Doit être renseigné iff analytic_axis_type l''est.'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_journal_entry_lines_analytic"
        ON "journal_entry_lines" ("organization_id", "analytic_axis_type", "analytic_axis_code")
        WHERE "analytic_axis_type" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_journal_entry_lines_analytic"`);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        DROP COLUMN IF EXISTS "analytic_axis_code",
        DROP COLUMN IF EXISTS "analytic_axis_type"
    `);
  }
}
