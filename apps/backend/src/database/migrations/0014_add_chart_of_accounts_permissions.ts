import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-PC-04 — étend le catalogue RBAC avec les permissions du plan
 * comptable et les attache aux rôles métier selon la matrice définie
 * dans `openspec/changes/module-2-plan-comptable/design.md` (D6).
 *
 *   - `chart_of_accounts.read`  : consulter le plan comptable de l'org.
 *     Tous les rôles utiles au quotidien comptable y ont accès, y
 *     compris l'auditeur en lecture seule et le client en
 *     lecture seule.
 *   - `chart_of_accounts.write` : créer / modifier / désactiver / supprimer
 *     des comptes custom. Réservé aux rôles avec autorité comptable :
 *     admin, expert-comptable, chef de mission.
 *
 * Idempotent via `ON CONFLICT DO NOTHING` sur les deux insertions —
 * cette migration peut donc être rejouée dans un environnement où elle
 * a déjà partiellement tourné (panne entre les deux INSERT).
 */
export class AddChartOfAccountsPermissions1700000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('chart_of_accounts.read',  'Read the organisation chart of accounts'),
        ('chart_of_accounts.write', 'Create, update, deactivate or delete custom accounts in the organisation chart')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        -- Read : tous les rôles métier — le plan comptable est un
        -- référentiel partagé qu'aucun utilisateur fonctionnel ne doit
        -- ignorer pour comprendre une balance ou un libellé d'écriture.
        ('admin',            'chart_of_accounts.read'),
        ('expert_comptable', 'chart_of_accounts.read'),
        ('chef_mission',     'chart_of_accounts.read'),
        ('comptable',        'chart_of_accounts.read'),
        ('auditeur',         'chart_of_accounts.read'),
        ('client_readonly',  'chart_of_accounts.read'),

        -- Write : autorité comptable uniquement. Le comptable de
        -- saisie n'a PAS le droit de créer des sous-comptes (il doit
        -- demander au chef de mission ou à l'expert-comptable) — cette
        -- discipline évite la prolifération anarchique de comptes
        -- "perso" qui pollue les balances analytiques.
        ('admin',            'chart_of_accounts.write'),
        ('expert_comptable', 'chart_of_accounts.write'),
        ('chef_mission',     'chart_of_accounts.write')
      ) AS m("role_code", "permission_code")
        ON m."role_code" = r."code" AND m."permission_code" = p."code"
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Symétrique : on retire d'abord les liaisons (matchées par le code
    // des permissions plutôt que par UUID, plus stable au rollback) puis
    // les permissions elles-mêmes.
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions"
        WHERE "code" IN ('chart_of_accounts.read', 'chart_of_accounts.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('chart_of_accounts.read', 'chart_of_accounts.write')
    `);
  }
}
