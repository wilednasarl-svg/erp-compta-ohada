import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-SCORE-02 — permissions RBAC pour le Module 20 (Accounting Score).
 *
 *   - `accounting_score.recalculate` : déclencher un recalcul (coûteux,
 *     scanne anomalies + documents + relevés + workflows). Restrictif.
 *   - `accounting_score.read`        : consulter le dernier score d'un
 *     exercice + son breakdown.
 *
 * Attribution :
 *   - Admin / Expert-comptable / Chef de mission : les 2 perms.
 *   - Comptable                                  : read seul.
 *   - Auditeur / Client readonly                 : read seul.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddAccountingScorePermissions1700000000082 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('accounting_score.recalculate', 'Trigger an accounting health score recalculation'),
        ('accounting_score.read',        'Read accounting health score and breakdown')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'accounting_score.recalculate'),
        ('admin',            'accounting_score.read'),
        ('expert_comptable', 'accounting_score.recalculate'),
        ('expert_comptable', 'accounting_score.read'),
        ('chef_mission',     'accounting_score.recalculate'),
        ('chef_mission',     'accounting_score.read'),
        ('comptable',        'accounting_score.read'),
        ('auditeur',         'accounting_score.read'),
        ('client_readonly',  'accounting_score.read')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions"
        WHERE "code" IN ('accounting_score.recalculate', 'accounting_score.read')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('accounting_score.recalculate', 'accounting_score.read')
    `);
  }
}
