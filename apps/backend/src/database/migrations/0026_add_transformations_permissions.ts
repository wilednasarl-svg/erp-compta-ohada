import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-TRF-02 — permissions du Module 4 Transformation Engine.
 *
 *   `transformations.read`  — consulter la liste et l'historique des
 *     transformations. Accessible à tous les rôles avec une responsabilité
 *     comptable : un auditeur doit pouvoir retracer l'origine de toute
 *     modification.
 *
 *   `transformations.write` — créer des transformations (reclassement,
 *     ajustement). Réservé aux rôles avec autorité comptable opérationnelle
 *     (admin, expert_comptable, chef_mission, comptable). Auditeur et
 *     client_readonly sont délibérément exclus — ils ne créent jamais de
 *     données comptables.
 *
 * Idempotent via `ON CONFLICT DO NOTHING`.
 */
export class AddTransformationsPermissions1700000000024 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('transformations.read',  'Read transformation history and entries'),
        ('transformations.write', 'Create reclassifications and adjustment entries')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        -- Read : tout rôle métier peut consulter l'historique
        -- pour tracer l'origine d'une écriture retraitée.
        ('admin',            'transformations.read'),
        ('expert_comptable', 'transformations.read'),
        ('chef_mission',     'transformations.read'),
        ('comptable',        'transformations.read'),
        ('auditeur',         'transformations.read'),

        -- Write : autorité comptable opérationnelle uniquement.
        -- L'auditeur ne modifie jamais les données, il les valide.
        ('admin',            'transformations.write'),
        ('expert_comptable', 'transformations.write'),
        ('chef_mission',     'transformations.write'),
        ('comptable',        'transformations.write')
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
        WHERE "code" IN ('transformations.read', 'transformations.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('transformations.read', 'transformations.write')
    `);
  }
}
