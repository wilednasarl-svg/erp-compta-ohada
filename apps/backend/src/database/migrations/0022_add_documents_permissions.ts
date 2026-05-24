import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-DOC-01 — extend the RBAC catalog with the Document Engine
 * permissions and attach them to the business roles.
 *
 *   - `documents.read`   : view documents metadata, download the bytes
 *     through the proxy endpoint, list / filter the org's documents.
 *     Granted to every role with a comptable / audit responsibility —
 *     auditeur included (the auditor must be able to retrieve the
 *     supporting voucher of any entry he challenges).
 *   - `documents.write`  : upload new documents, attach tags, link
 *     them to journal entries, soft-delete. Restricted to roles with
 *     operational authority on accounting data — auditeur and
 *     client_readonly are excluded by design.
 *
 * Mirrors the convention established by `0018_add_imports_permissions.ts`
 * (idempotent via `ON CONFLICT DO NOTHING`).
 */
export class AddDocumentsPermissions1700000000022 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('documents.read',  'Read documents metadata and download content'),
        ('documents.write', 'Upload, tag, link to entries and soft-delete documents')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        -- Read : every role with a comptable / audit responsibility
        -- must be able to retrieve the supporting voucher attached to
        -- an entry — auditeur included.
        ('admin',            'documents.read'),
        ('expert_comptable', 'documents.read'),
        ('chef_mission',     'documents.read'),
        ('comptable',        'documents.read'),
        ('auditeur',         'documents.read'),

        -- Write : operational authority on accounting data. auditeur
        -- and client_readonly are deliberately excluded.
        ('admin',            'documents.write'),
        ('expert_comptable', 'documents.write'),
        ('chef_mission',     'documents.write'),
        ('comptable',        'documents.write')
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
        WHERE "code" IN ('documents.read', 'documents.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('documents.read', 'documents.write')
    `);
  }
}
