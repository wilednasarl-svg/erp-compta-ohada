import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-FX-03 — permissions RBAC pour Module 16 (Multi-devises).
 *
 *   - `fx.read`  : consulter le catalogue + historique des taux.
 *   - `fx.write` : créer/désactiver une devise, saisir un taux manuel.
 *
 * En wave 1, pas de permission séparée pour "convertir" — la
 * conversion ne mute rien, c'est une lecture (couvert par `fx.read`).
 *
 * Attribution :
 *   - Admin, Expert-comptable, Chef de mission, Comptable : read+write.
 *   - Auditeur, Client readonly                            : read seul.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddFxPermissions1700000000065 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('fx.read',  'Read currency catalog and exchange-rate history'),
        ('fx.write', 'Manage currencies and post manual exchange rates')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'fx.read'),
        ('admin',            'fx.write'),
        ('expert_comptable', 'fx.read'),
        ('expert_comptable', 'fx.write'),
        ('chef_mission',     'fx.read'),
        ('chef_mission',     'fx.write'),
        ('comptable',        'fx.read'),
        ('comptable',        'fx.write'),
        ('auditeur',         'fx.read'),
        ('client_readonly',  'fx.read')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" IN ('fx.read', 'fx.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN ('fx.read', 'fx.write')
    `);
  }
}
