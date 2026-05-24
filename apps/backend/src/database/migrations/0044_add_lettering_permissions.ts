import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-LET-02 — permission RBAC pour le lettrage tiers (Module 8 wave 2).
 *
 * `journals.lettering` autorise la création ET la rupture d'un lettrage.
 * `journals.read` couvre la lecture (balance lettrée / non-lettrée).
 *
 * Attribution :
 *   - Admin, Expert-comptable, Chef de mission, Comptable : oui.
 *     Le lettrage est une opération comptable courante.
 *   - Auditeur / Client readonly : non — read seulement via journals.read.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddLetteringPermissions1700000000044 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('journals.lettering', 'Reconcile partner account lines (create or break a lettering)')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'journals.lettering'),
        ('expert_comptable', 'journals.lettering'),
        ('chef_mission',     'journals.lettering'),
        ('comptable',        'journals.lettering')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'journals.lettering'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" = 'journals.lettering'
    `);
  }
}
