import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMP-04 — étend le catalogue RBAC avec les permissions du module
 * d'import et les attache aux rôles métier :
 *
 *   - `imports.read`   : lire la liste des sessions d'import, leur
 *     statut, leurs erreurs. Tous les rôles avec une responsabilité
 *     comptable y ont accès — un comptable doit pouvoir vérifier où en
 *     est l'import lancé par son chef de mission.
 *   - `imports.write`  : créer une session, uploader des fichiers,
 *     lancer parsing/preview. Réservé aux rôles avec autorité comptable
 *     (admin, expert_comptable, chef_mission, comptable). Auditeur et
 *     client_readonly ne peuvent pas modifier les données — donc pas
 *     plus uploader des fichiers d'écritures.
 *
 * `imports.commit` (commit définitif vers tables comptables) sera ajouté
 * au Module 3 vague 2 quand l'écriture en table finale arrivera.
 *
 * Idempotent via `ON CONFLICT DO NOTHING`.
 */
export class AddImportsPermissions1700000000018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('imports.read',  'Read import sessions, files and staging entries'),
        ('imports.write', 'Create import sessions, upload files, run parsing and preview')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        -- Read : tout rôle avec un usage métier de la comptabilité doit
        -- pouvoir consulter l'état d'un import (un comptable qui ouvre
        -- la session lancée par son chef de mission, un auditeur qui
        -- veut tracer l'origine d'une écriture).
        ('admin',            'imports.read'),
        ('expert_comptable', 'imports.read'),
        ('chef_mission',     'imports.read'),
        ('comptable',        'imports.read'),
        ('auditeur',         'imports.read'),

        -- Write : autorité comptable opérationnelle. client_readonly
        -- et auditeur sont délibérément exclus — l'auditeur ne crée
        -- jamais de données comptables, il les valide.
        ('admin',            'imports.write'),
        ('expert_comptable', 'imports.write'),
        ('chef_mission',     'imports.write'),
        ('comptable',        'imports.write')
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
        WHERE "code" IN ('imports.read', 'imports.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('imports.read', 'imports.write')
    `);
  }
}
