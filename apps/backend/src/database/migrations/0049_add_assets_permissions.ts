import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMMO-04 — permissions RBAC pour le Module 12 (Immobilisations).
 *
 *   - `assets.read`              : consulter le registre et l'échéancier.
 *   - `assets.write`             : créer / modifier / mettre au rebut.
 *   - `assets.post_depreciation` : poster les dotations comme écritures
 *     comptables validées (impact direct sur les comptes 28x/681x). Plus
 *     restrictif : seuls les comptables et au-dessus.
 *
 * Attribution :
 *   - Admin, Expert-comptable, Chef de mission, Comptable : les 3 perms.
 *   - Auditeur                                            : read seul.
 *   - Client readonly                                     : read seul.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddAssetsPermissions1700000000049 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('assets.read',              'Read the fixed-assets register and depreciation schedule'),
        ('assets.write',             'Create / update / dispose fixed assets'),
        ('assets.post_depreciation', 'Post periodic depreciation as journal entries')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'assets.read'),
        ('admin',            'assets.write'),
        ('admin',            'assets.post_depreciation'),
        ('expert_comptable', 'assets.read'),
        ('expert_comptable', 'assets.write'),
        ('expert_comptable', 'assets.post_depreciation'),
        ('chef_mission',     'assets.read'),
        ('chef_mission',     'assets.write'),
        ('chef_mission',     'assets.post_depreciation'),
        ('comptable',        'assets.read'),
        ('comptable',        'assets.write'),
        ('comptable',        'assets.post_depreciation'),
        ('auditeur',         'assets.read'),
        ('client_readonly',  'assets.read')
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
        WHERE "code" IN ('assets.read', 'assets.write', 'assets.post_depreciation')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('assets.read', 'assets.write', 'assets.post_depreciation')
    `);
  }
}
