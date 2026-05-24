import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-JE-06 — permissions RBAC du Module 8.
 *
 *   - `journals.read`         : tous les rôles métier.
 *   - `journals.write`        : Admin, Expert-comptable, Chef de mission,
 *     Comptable. Création + édition de drafts.
 *   - `journals.validate`     : Admin, Expert-comptable, Chef de mission.
 *     L'écriture validée devient immutable — pouvoir réservé aux rôles
 *     d'autorité comptable.
 *   - `journals.close_period` : Admin + Expert-comptable uniquement.
 *     Clôture périodique (mensuelle, trimestrielle, annuelle).
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddJournalsPermissions1700000000041 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('journals.read',         'Read journals, entries, lines, and accounting periods'),
        ('journals.write',        'Create and edit draft journal entries; create custom journals'),
        ('journals.validate',     'Validate or cancel a journal entry (immutability gate)'),
        ('journals.close_period', 'Close or reopen an accounting period')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        -- Read : tout rôle métier
        ('admin',            'journals.read'),
        ('expert_comptable', 'journals.read'),
        ('chef_mission',     'journals.read'),
        ('comptable',        'journals.read'),
        ('auditeur',         'journals.read'),
        ('client_readonly',  'journals.read'),

        -- Write : autorité opérationnelle
        ('admin',            'journals.write'),
        ('expert_comptable', 'journals.write'),
        ('chef_mission',     'journals.write'),
        ('comptable',        'journals.write'),

        -- Validate : autorité de validation (immutabilité)
        ('admin',            'journals.validate'),
        ('expert_comptable', 'journals.validate'),
        ('chef_mission',     'journals.validate'),

        -- Close period : autorité fiscale / réglementaire
        ('admin',            'journals.close_period'),
        ('expert_comptable', 'journals.close_period')
      ) AS m("role_code", "permission_code")
        ON m."role_code" = r."code" AND m."permission_code" = p."code"
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions"
        WHERE "code" IN ('journals.read', 'journals.write', 'journals.validate', 'journals.close_period')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('journals.read', 'journals.write', 'journals.validate', 'journals.close_period')
    `);
  }
}
