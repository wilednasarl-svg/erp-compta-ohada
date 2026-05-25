import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-AI-02 — permissions RBAC pour le Module 11 (AI Engine).
 *
 *   - `ai.scan`     : lancer un scan d'anomalies sur une période.
 *                     Restrictif (impact DB + temps CPU) — réservé aux
 *                     rôles métier supérieurs.
 *   - `ai.read`     : consulter les anomalies déjà détectées.
 *   - `ai.suggest`  : demander une suggestion de compte pour une
 *                     écriture (lecture seule, pas d'effet de bord
 *                     persisté en wave 1).
 *
 * Attribution :
 *   - Admin, Expert-comptable, Chef de mission : les 3 perms.
 *   - Comptable                                : read + suggest
 *     (consultation + aide à la saisie, mais pas le droit de
 *     déclencher un scan complet — coûteux).
 *   - Auditeur                                 : read seul.
 *   - Client readonly                          : read seul.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddAiPermissions1700000000070 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('ai.scan',    'Trigger a full AI anomaly scan on an accounting period'),
        ('ai.read',    'Read AI anomalies and risk scores'),
        ('ai.suggest', 'Request an account suggestion for a draft entry')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'ai.scan'),
        ('admin',            'ai.read'),
        ('admin',            'ai.suggest'),
        ('expert_comptable', 'ai.scan'),
        ('expert_comptable', 'ai.read'),
        ('expert_comptable', 'ai.suggest'),
        ('chef_mission',     'ai.scan'),
        ('chef_mission',     'ai.read'),
        ('chef_mission',     'ai.suggest'),
        ('comptable',        'ai.read'),
        ('comptable',        'ai.suggest'),
        ('auditeur',         'ai.read'),
        ('client_readonly',  'ai.read')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" IN ('ai.scan', 'ai.read', 'ai.suggest')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" IN ('ai.scan', 'ai.read', 'ai.suggest')
    `);
  }
}
