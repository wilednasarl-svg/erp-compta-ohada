import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module Budget — permissions RBAC.
 *
 *   `budget.read`  : lecture des axes analytiques, lignes budgétaires et
 *                    états d'écart (réalisé vs budget) / KPI.
 *   `budget.write` : création / modification d'axes et de lignes,
 *                    transitions de validation, import.
 *
 * Attribution :
 *   - Admin, Expert-comptable, Chef de mission : read + write.
 *   - Comptable : read + write (saisie budgétaire courante).
 *   - Auditeur : read seul (revue analytique des écarts).
 *   - Client readonly : read seul.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddBudgetPermissions1700000000112 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('budget.read',  'Read budget axes, lines and variance/KPI reports'),
        ('budget.write', 'Manage budget axes, lines, validation transitions and imports')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'budget.read'),
        ('admin',            'budget.write'),
        ('expert_comptable', 'budget.read'),
        ('expert_comptable', 'budget.write'),
        ('chef_mission',     'budget.read'),
        ('chef_mission',     'budget.write'),
        ('comptable',        'budget.read'),
        ('comptable',        'budget.write'),
        ('auditeur',         'budget.read'),
        ('client_readonly',  'budget.read')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" IN ('budget.read', 'budget.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN ('budget.read', 'budget.write')
    `);
  }
}
