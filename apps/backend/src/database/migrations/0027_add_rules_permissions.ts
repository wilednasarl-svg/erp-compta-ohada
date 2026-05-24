import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-RULE-03 — permissions du Module 5 Rule Engine.
 *
 *   `rules.read`     — consulter la liste des règles et l'historique
 *     d'exécution. Ouvert à tous les rôles avec responsabilité comptable :
 *     un auditeur doit comprendre quelles règles ont automatisé quoi.
 *
 *   `rules.write`    — créer, modifier et activer/désactiver des règles.
 *     Réservé aux rôles avec autorité comptable opérationnelle.
 *
 *   `rules.simulate` — simuler une règle sur un périmètre sans appliquer
 *     de transformations réelles. Accessible aux comptables et au-dessus
 *     pour tester une règle avant activation.
 *
 *   `rules.apply`    — appliquer une règle (crée des transformations via
 *     TransformationService). Réservé aux rôles senior uniquement — c'est
 *     une action irréversible (les transformations créées restent en base).
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddRulesPermissions1700000000027 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('rules.read',     'Read rules and execution history'),
        ('rules.write',    'Create, update, and activate/deactivate rules'),
        ('rules.simulate', 'Simulate a rule on a scope without applying transformations'),
        ('rules.apply',    'Apply a rule — creates transformations via TransformationService')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'rules.read'),
        ('admin',            'rules.write'),
        ('admin',            'rules.simulate'),
        ('admin',            'rules.apply'),
        ('expert_comptable', 'rules.read'),
        ('expert_comptable', 'rules.write'),
        ('expert_comptable', 'rules.simulate'),
        ('expert_comptable', 'rules.apply'),
        ('chef_mission',     'rules.read'),
        ('chef_mission',     'rules.write'),
        ('chef_mission',     'rules.simulate'),
        ('chef_mission',     'rules.apply'),
        ('comptable',        'rules.read'),
        ('comptable',        'rules.simulate'),
        ('auditeur',         'rules.read'),
        ('client_readonly',  'rules.read')
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
        WHERE "code" IN ('rules.read', 'rules.write', 'rules.simulate', 'rules.apply')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('rules.read', 'rules.write', 'rules.simulate', 'rules.apply')
    `);
  }
}
