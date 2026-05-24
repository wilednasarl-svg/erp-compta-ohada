import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-WF-04 — permissions RBAC et définition de workflow de base.
 *
 * Permissions créées :
 *   - `workflows.read`    : consulter les instances et l'historique.
 *   - `workflows.write`   : démarrer un workflow, appliquer les transitions
 *     `draft → in_review` et `in_review → draft`.
 *   - `workflows.approve` : appliquer les transitions `in_review → approved`
 *     et `approved → locked` (rôles à autorité de validation).
 *
 * Attribution par rôle :
 *   - admin           : read + write + approve
 *   - expert_comptable: read + write + approve
 *   - chef_mission    : read + write + approve
 *   - comptable       : read + write (peut soumettre, pas approuver)
 *   - auditeur        : read only
 *   - client_readonly : read only
 *
 * Seed la définition de workflow standard pour `import_session`.
 */
export class SeedWorkflowPermissions1700000000031 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Permissions
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('workflows.read',    'Read workflow instances and history'),
        ('workflows.write',   'Start workflows and apply basic transitions'),
        ('workflows.approve', 'Apply approval and lock transitions')
      ON CONFLICT ("code") DO NOTHING
    `);

    // Role mappings
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'workflows.read'),
        ('admin',            'workflows.write'),
        ('admin',            'workflows.approve'),
        ('expert_comptable', 'workflows.read'),
        ('expert_comptable', 'workflows.write'),
        ('expert_comptable', 'workflows.approve'),
        ('chef_mission',     'workflows.read'),
        ('chef_mission',     'workflows.write'),
        ('chef_mission',     'workflows.approve'),
        ('comptable',        'workflows.read'),
        ('comptable',        'workflows.write'),
        ('auditeur',         'workflows.read'),
        ('client_readonly',  'workflows.read')
      ) AS m("role_code", "permission_code")
        ON m."role_code" = r."code" AND m."permission_code" = p."code"
      ON CONFLICT DO NOTHING
    `);

    // Seed definition for import_session workflow
    await queryRunner.query(`
      INSERT INTO "workflow_definitions" ("name", "description", "target_type", "is_active")
      VALUES (
        'Workflow de validation d''import',
        'Validation multi-niveaux d''une session d''import (draft → in_review → approved → locked).',
        'import_session',
        TRUE
      )
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions"
        WHERE "code" IN ('workflows.read', 'workflows.write', 'workflows.approve')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('workflows.read', 'workflows.write', 'workflows.approve')
    `);
    await queryRunner.query(`
      DELETE FROM "workflow_definitions" WHERE "target_type" = 'import_session'
    `);
  }
}
