import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DASH-01 — permission RBAC pour Module 19 Dashboards.
 *
 * `dashboards.read` : consulter les endpoints `summary` et `aging`
 * sous `/organizations/:id/dashboards/`. Comme les états de Module 9
 * (`journals.reports`), c'est un droit de lecture pure attribué à
 * TOUS les rôles métier — un comptable junior comme un client
 * read-only doivent pouvoir voir les KPIs de leur dossier. Les
 * écritures, validations et mutations restent gouvernées par les
 * permissions spécifiques de chaque module.
 *
 * Idempotent via ON CONFLICT DO NOTHING (pattern identique aux autres
 * migrations de permissions du projet).
 */
export class AddDashboardsPermission1700000000076 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('dashboards.read', 'Read accounting dashboards (summary KPIs, aging)')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'dashboards.read'
      WHERE r."code" IN (
        'admin',
        'expert_comptable',
        'chef_mission',
        'comptable',
        'auditeur',
        'client_readonly'
      )
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'dashboards.read'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" = 'dashboards.read'
    `);
  }
}
