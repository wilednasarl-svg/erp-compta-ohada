import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W2.4 — `note_annexe_comments` : persistance des saisies libres du
 * comptable pour les Notes annexes SYSCOHADA.
 *
 * Une ligne par triplet (organization, exercise, noteId). L'`exercise_id`
 * référence un `accounting_periods.id` de type ANNUAL. Pas de FK
 * formelle vers `accounting_periods` pour éviter le couplage cyclique
 * du module Reports avec le module Periods — le contrôle d'existence
 * est applicatif.
 *
 * `note_id` est un VARCHAR(8) : couvre 'N1'..'N36' avec suffixes
 * A/B/C/D/E. Un CHECK explicite garantit le format.
 */
export class CreateNoteAnnexeComments1700000000091 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "note_annexe_comments" (
        "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" UUID         NOT NULL,
        "exercise_id"     UUID         NOT NULL,
        "note_id"         VARCHAR(8)   NOT NULL,
        "comment_text"    TEXT         NOT NULL DEFAULT '',
        "applicable"      BOOLEAN      NOT NULL DEFAULT true,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_note_annexe_comments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_note_annexe_comments_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_note_annexe_comments_org_exercise_note"
          UNIQUE ("organization_id", "exercise_id", "note_id"),
        CONSTRAINT "chk_note_annexe_comments_note_id_format"
          CHECK ("note_id" ~ '^N[0-9]{1,2}[A-E]?$')
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_note_annexe_comments_org_exercise"
        ON "note_annexe_comments" ("organization_id", "exercise_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "note_annexe_comments"`);
  }
}
