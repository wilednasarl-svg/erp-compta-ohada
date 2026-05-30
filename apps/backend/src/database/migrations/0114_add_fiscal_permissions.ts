import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module Fiscal & Social — permissions RBAC.
 *
 *   `fiscal.read`  : lecture des paramètres (taux) et déclarations / échéancier.
 *   `fiscal.write` : gestion des paramètres, génération/édition de déclarations,
 *                    transitions de statut (déposé / payé).
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddFiscalPermissions1700000000114 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('fiscal.read',  'Read fiscal/social parameters and declarations'),
        ('fiscal.write', 'Manage fiscal/social parameters, declarations and filing transitions')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'fiscal.read'),
        ('admin',            'fiscal.write'),
        ('expert_comptable', 'fiscal.read'),
        ('expert_comptable', 'fiscal.write'),
        ('chef_mission',     'fiscal.read'),
        ('chef_mission',     'fiscal.write'),
        ('comptable',        'fiscal.read'),
        ('comptable',        'fiscal.write'),
        ('auditeur',         'fiscal.read'),
        ('client_readonly',  'fiscal.read')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" IN ('fiscal.read', 'fiscal.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN ('fiscal.read', 'fiscal.write')
    `);
  }
}
