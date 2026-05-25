import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-COLLAB-03 — permissions RBAC pour le Module 21 (Collaboration).
 *
 *   - `collaboration.read`    : voir les demandes et leurs commentaires.
 *                                Toutes les seats (cabinet + client).
 *   - `collaboration.write`   : créer une nouvelle demande. EXCLUSIF
 *                                au cabinet — un client ne peut pas
 *                                instancier une demande de justificatif
 *                                à lui-même.
 *   - `collaboration.respond` : commenter ET changer le statut d'une
 *                                demande visible. Porté par les DEUX
 *                                faces (cabinet pour répondre /
 *                                rouvrir / annuler, client pour passer
 *                                en in_progress / completed). Le
 *                                scope-filter du service
 *                                (CollaborationViewScope) empêche un
 *                                client de toucher à une demande qui
 *                                ne lui est pas assignée.
 *
 * Attribution :
 *   - admin / expert_comptable / chef_mission / comptable
 *       → read + write + respond
 *   - auditeur            → read seul
 *   - client_readonly     → read + respond
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddCollaborationPermissions1700000000080 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('collaboration.read',    'Read collaboration requests and comments'),
        ('collaboration.write',   'Create, cancel and comment on collaboration requests (cabinet side)'),
        ('collaboration.respond', 'Update status and comment on assigned collaboration requests (client side)')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'collaboration.read'),
        ('admin',            'collaboration.write'),
        ('admin',            'collaboration.respond'),
        ('expert_comptable', 'collaboration.read'),
        ('expert_comptable', 'collaboration.write'),
        ('expert_comptable', 'collaboration.respond'),
        ('chef_mission',     'collaboration.read'),
        ('chef_mission',     'collaboration.write'),
        ('chef_mission',     'collaboration.respond'),
        ('comptable',        'collaboration.read'),
        ('comptable',        'collaboration.write'),
        ('comptable',        'collaboration.respond'),
        ('auditeur',         'collaboration.read'),
        ('client_readonly',  'collaboration.read'),
        ('client_readonly',  'collaboration.respond')
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
        WHERE "code" IN ('collaboration.read', 'collaboration.write', 'collaboration.respond')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('collaboration.read', 'collaboration.write', 'collaboration.respond')
    `);
  }
}
