import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-STOCK-03 — permissions RBAC pour Module 17 (Inventaire).
 *
 *   - `inventory.read`   : consulter articles + journal des mouvements.
 *   - `inventory.write`  : créer un article, archiver, modifier les
 *                         comptes par défaut.
 *   - `inventory.move`   : enregistrer un mouvement (entrée/sortie/
 *                         ajustement). Mute la qty + le CMP courant.
 *   - `inventory.count`  : valider un inventaire physique annuel.
 *                         Plus restrictif (signature comptable).
 *
 * Attribution :
 *   - Admin, EC, CM, comptable           : read + write + move + count.
 *   - Auditeur, Client readonly          : read seul.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddInventoryPermissions1700000000068 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('inventory.read',  'Read inventory items and movement history'),
        ('inventory.write', 'Create / update / archive inventory items'),
        ('inventory.move',  'Record purchase / sale / adjustment movements'),
        ('inventory.count', 'Validate annual physical inventory counts')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'inventory.read'),
        ('admin',            'inventory.write'),
        ('admin',            'inventory.move'),
        ('admin',            'inventory.count'),
        ('expert_comptable', 'inventory.read'),
        ('expert_comptable', 'inventory.write'),
        ('expert_comptable', 'inventory.move'),
        ('expert_comptable', 'inventory.count'),
        ('chef_mission',     'inventory.read'),
        ('chef_mission',     'inventory.write'),
        ('chef_mission',     'inventory.move'),
        ('chef_mission',     'inventory.count'),
        ('comptable',        'inventory.read'),
        ('comptable',        'inventory.write'),
        ('comptable',        'inventory.move'),
        ('comptable',        'inventory.count'),
        ('auditeur',         'inventory.read'),
        ('client_readonly',  'inventory.read')
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
        WHERE "code" IN ('inventory.read', 'inventory.write',
                         'inventory.move', 'inventory.count')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('inventory.read', 'inventory.write',
                       'inventory.move', 'inventory.count')
    `);
  }
}
