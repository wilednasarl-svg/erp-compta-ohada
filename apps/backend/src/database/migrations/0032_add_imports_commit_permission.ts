import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-IMP-W2-01 — ajoute la permission `imports.commit` annoncée dans
 * 0018 et l'attache aux rôles avec autorité comptable complète.
 *
 *   `imports.commit` : déclencher le commit définitif d'une session
 *     validée vers les tables comptables finales. Réservé aux rôles
 *     pouvant engager la comptabilité (admin, expert_comptable,
 *     chef_mission). Le `comptable` peut uploader/parser (`imports.write`)
 *     mais ne peut pas committer — la validation finale reste sous la
 *     responsabilité du chef de mission ou de l'expert.
 *
 * Idempotent via `ON CONFLICT DO NOTHING`.
 *
 * Numéroté 0032 (après les workflows 0028-0031) pour éviter toute
 * collision de timestamp avec les migrations Module 5 (transformations
 * 023-024) et Module 5b (rules 025-027) ajoutées en parallèle. Cette
 * migration n'a aucune dépendance vers les tables Module 5/5b — elle
 * ne touche que `permissions` + `role_permissions` seedés par
 * Module 1 (0004/0005), donc un ordre tardif est sans conséquence.
 */
export class AddImportsCommitPermission1700000000032 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('imports.commit', 'Commit a validated import session to the accounting ledger')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON p."code" = 'imports.commit'
      WHERE r."code" IN ('admin', 'expert_comptable', 'chef_mission')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "code" = 'imports.commit'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "code" = 'imports.commit'
    `);
  }
}
