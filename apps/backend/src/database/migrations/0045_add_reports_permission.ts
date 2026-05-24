import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-RPT-01 — permission RBAC pour les états financiers Module 9.
 *
 * `journals.reports` donne accès aux endpoints de lecture agrégée :
 *   - GET /organizations/:id/reports/trial-balance
 *   - GET /organizations/:id/reports/general-ledger/:accountId
 *   - (wave 2) /reports/profit-loss + /reports/balance-sheet
 *
 * Attribution :
 *   - Admin, Expert-comptable, Chef de mission, Comptable : oui.
 *     Tous les rôles métier qui produisent les états légaux.
 *   - Auditeur : OUI — l'auditeur externe lit la balance + grand livre
 *     pour son contrôle ; c'est un cas d'usage principal.
 *   - Client readonly : OUI — le client peut consulter sa propre
 *     comptabilité agrégée.
 *
 * Note : la permission est strictement read. Pas de mutation possible.
 *
 * Idempotent via ON CONFLICT DO NOTHING.
 */
export class AddReportsPermission1700000000045 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('journals.reports', 'Read accounting reports (trial balance, general ledger, financial statements)')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'journals.reports'),
        ('expert_comptable', 'journals.reports'),
        ('chef_mission',     'journals.reports'),
        ('comptable',        'journals.reports'),
        ('auditeur',         'journals.reports'),
        ('client_readonly',  'journals.reports')
      ) AS mapping(role_code, perm_code)
        ON r."code" = mapping.role_code AND p."code" = mapping.perm_code
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'journals.reports'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" = 'journals.reports'
    `);
  }
}
