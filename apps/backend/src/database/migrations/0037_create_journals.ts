import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-JE-02 — `journals` : catalogue des journaux par organisation.
 *
 * 5 journaux SYSCOHADA standards seedés à la création d'une org via
 * `JournalsService.seedStandardJournals` (appelé dans la même transaction
 * que `OrganizationsService.create`). L'org peut ajouter des sous-journaux
 * personnalisés (ex: `BQ-01`, `BQ-02` pour plusieurs banques).
 *
 *   - `code`              : identifiant scopé tenant (UNIQUE org+code).
 *     Format `^[A-Z0-9-]{1,8}$` (validé côté DTO).
 *   - `kind`              : classe SYSCOHADA — AC | VE | BQ | CA | OD.
 *     Un sous-journal `BQ-01` a kind=`BQ`.
 *   - `next_entry_number` : compteur incrémenté en transaction à chaque
 *     INSERT d'une `journal_entries`. Numéro de pièce immutable, séquentiel
 *     par journal, scopé tenant. Voir design D3.
 *   - `is_active`         : soft-disable un journal sans le supprimer.
 *     Les entries existantes restent lisibles ; pas de nouvelle entry.
 */
export class CreateJournals1700000000037 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "journals" (
        "id"                 UUID        NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"    UUID        NOT NULL,
        "code"               TEXT        NOT NULL,
        "label"              TEXT        NOT NULL,
        "kind"               TEXT        NOT NULL,
        "next_entry_number"  INTEGER     NOT NULL DEFAULT 1,
        "is_active"          BOOLEAN     NOT NULL DEFAULT TRUE,
        "default_account_id" UUID,
        "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_journals" PRIMARY KEY ("id"),
        CONSTRAINT "fk_journals_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_journals_org_code"
          UNIQUE ("organization_id", "code"),
        CONSTRAINT "chk_journals_kind"
          CHECK ("kind" IN ('AC', 'VE', 'BQ', 'CA', 'OD')),
        CONSTRAINT "chk_journals_code_format"
          CHECK ("code" ~ '^[A-Z0-9-]{1,8}$'),
        CONSTRAINT "chk_journals_next_entry_number_positive"
          CHECK ("next_entry_number" >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_journals_org_kind"
        ON "journals" ("organization_id", "kind")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "journals"`);
  }
}
