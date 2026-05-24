import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-TVA-04 — permissions RBAC Module 13.
 *
 *   `tva.read`  : lecture des codes TVA + déclarations
 *   `tva.write` : création / modification de codes TVA + compute /
 *                 cancel de déclarations
 *
 * Attribution :
 *   - Admin, Expert-comptable, Chef de mission : read + write.
 *   - Comptable : read + write (saisie courante + compute).
 *   - Auditeur : read seul (consultation pour son contrôle).
 *   - Client readonly : read seul.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddTvaPermissions1700000000049 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('tva.read',  'Read TVA codes and declarations'),
        ('tva.write', 'Manage TVA codes and compute/cancel declarations')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'tva.read'),
        ('admin',            'tva.write'),
        ('expert_comptable', 'tva.read'),
        ('expert_comptable', 'tva.write'),
        ('chef_mission',     'tva.read'),
        ('chef_mission',     'tva.write'),
        ('comptable',        'tva.read'),
        ('comptable',        'tva.write'),
        ('auditeur',         'tva.read'),
        ('client_readonly',  'tva.read')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" IN ('tva.read', 'tva.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN ('tva.read', 'tva.write')
    `);
  }
}
