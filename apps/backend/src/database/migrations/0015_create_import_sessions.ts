import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMP-01 — `import_sessions` : sessions d'import comptable.
 *
 * Une session représente une tentative d'import d'écritures (Excel / CSV /
 * Sage) pour une organisation. Elle vit selon le cycle :
 *
 *   draft → parsing → parsed → validated → ready_for_import → completed
 *                                ↘ failed (terminal, à tout moment)
 *
 * Les écritures effectivement comptables n'arrivent PAS encore — le
 * Module 3 vague 1 s'arrête à `validated` (preview disponible). L'écriture
 * en table comptable finale viendra avec Module 3 vague 2 ou Module 4.
 *
 *   - `organization_id` : tenant scope (multi-tenant invariant).
 *   - `company_id` / `fiscal_year` : placeholders pour quand Module 2
 *     ajoutera l'entité `Company` (dossier comptable) et la notion
 *     d'exercice. Restent nullable pour ne pas bloquer le Module 3 sur
 *     l'avancement Module 2.
 *   - `source_type` : indication informationnelle du format attendu.
 *     L'auto-détection MIME du parser reste l'autorité au runtime.
 *   - `total_lines` / `error_lines` : compteurs cachés calculés à la
 *     génération de preview. Permet aux dashboards de lister les
 *     sessions sans relire les lignes staging.
 *   - `failure_reason` : message libre quand `status = failed`. Facilite
 *     le debug sans avoir à fouiller les logs.
 */
export class CreateImportSessions1700000000015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "import_sessions" (
        "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" UUID         NOT NULL,
        "company_id"      TEXT         NULL,
        "fiscal_year"     TEXT         NULL,
        "label"           TEXT         NULL,
        "source_type"     TEXT         NOT NULL,
        "status"          TEXT         NOT NULL DEFAULT 'draft',
        "total_lines"     INTEGER      NOT NULL DEFAULT 0,
        "error_lines"     INTEGER      NOT NULL DEFAULT 0,
        "failure_reason"  TEXT         NULL,
        "created_by"      UUID         NOT NULL,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_import_sessions_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_import_sessions_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "chk_import_sessions_source_type"
          CHECK ("source_type" IN ('csv', 'excel', 'sage', 'txt')),
        CONSTRAINT "chk_import_sessions_status"
          CHECK ("status" IN (
            'draft', 'parsing', 'parsed', 'validated',
            'ready_for_import', 'completed', 'failed'
          )),
        CONSTRAINT "chk_import_sessions_total_lines_positive"
          CHECK ("total_lines" >= 0),
        CONSTRAINT "chk_import_sessions_error_lines_positive"
          CHECK ("error_lines" >= 0 AND "error_lines" <= "total_lines")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "ix_import_sessions_org_status_created"
         ON "import_sessions" ("organization_id", "status", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_import_sessions_org_created_by"
         ON "import_sessions" ("organization_id", "created_by")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_import_sessions_org_created_by"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_import_sessions_org_status_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "import_sessions"`);
  }
}
