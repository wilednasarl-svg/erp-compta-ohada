import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module 14 wave 1 — RBAC permissions.
 *
 *   `journals.review` : revue + signature de niveau 1 (chef de mission).
 *   `journals.sign`   : signature finale (expert-comptable) qui verrouille
 *                       l'écriture (validated) et lock le workflow.
 *
 * Attribution :
 *   - Admin                : review + sign (full)
 *   - Expert-comptable     : review + sign (signataire final)
 *   - Chef de mission      : review uniquement
 *   - Comptable / Auditeur / Client : aucune (saisie seulement via journals.write)
 *
 * Idempotent (ON CONFLICT DO NOTHING).
 */
export class AddJournalsReviewSignPermissions1700000000056 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('journals.review', 'Review and sign a journal entry as chef de mission'),
        ('journals.sign',   'Sign a journal entry as expert-comptable (final lock)')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'journals.review'),
        ('admin',            'journals.sign'),
        ('expert_comptable', 'journals.review'),
        ('expert_comptable', 'journals.sign'),
        ('chef_mission',     'journals.review')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" IN ('journals.review', 'journals.sign')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN ('journals.review', 'journals.sign')
    `);
  }
}
