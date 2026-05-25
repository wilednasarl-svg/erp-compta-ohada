import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-BANK-06 — permissions RBAC Module 15.
 *
 *   - `bank.read`      : lecture (comptes, relevés, historique)
 *   - `bank.import`    : import fichier relevé
 *   - `bank.reconcile` : match / unmatch
 *   - `bank.admin`     : créer / modifier comptes bancaires
 */
export class AddBankReconciliationPermissions1700000000075 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('bank.read',      'Read bank accounts, statements and reconciliation history'),
        ('bank.import',    'Import bank statement files (CSV/OFX/MT940)'),
        ('bank.reconcile', 'Match / unmatch statement lines against journal entry lines'),
        ('bank.admin',     'Create / update bank accounts (IBAN, chart-account mapping)')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'bank.read'),
        ('admin',            'bank.import'),
        ('admin',            'bank.reconcile'),
        ('admin',            'bank.admin'),
        ('expert_comptable', 'bank.read'),
        ('expert_comptable', 'bank.import'),
        ('expert_comptable', 'bank.reconcile'),
        ('expert_comptable', 'bank.admin'),
        ('chef_mission',     'bank.read'),
        ('chef_mission',     'bank.import'),
        ('chef_mission',     'bank.reconcile'),
        ('comptable',        'bank.read'),
        ('comptable',        'bank.import'),
        ('comptable',        'bank.reconcile'),
        ('auditeur',         'bank.read'),
        ('client_readonly',  'bank.read')
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
        WHERE "code" IN ('bank.read', 'bank.import', 'bank.reconcile', 'bank.admin')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('bank.read', 'bank.import', 'bank.reconcile', 'bank.admin')
    `);
  }
}
