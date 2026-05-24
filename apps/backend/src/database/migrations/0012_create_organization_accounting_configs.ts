import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-PC-02 — `organization_accounting_configs` : table 1-1 avec
 * `organizations` qui fige le système comptable choisi à la création
 * de l'organisation.
 *
 * Design D2 (cf. `openspec/changes/module-2-plan-comptable/design.md`) :
 * le système est **immuable** une fois fixé. Changer de système (par
 * exemple passer de Minimal à Normal parce que le CA a franchi un
 * seuil) impose une migration comptable formelle (rapprochement des
 * encaissements, retraitements TVA) — c'est un événement métier, pas
 * un toggle. Le schéma le matérialise via l'absence d'endpoint UPDATE
 * sur ce champ (pas une CHECK contrainte — les évolutions futures
 * passeront par une procédure de migration applicative dédiée).
 *
 * PK = `organization_id` → relation 1-1 native. CASCADE sur la
 * suppression de l'organisation (soft-delete via `deleted_at` côté
 * `organizations` ; pour un hard-delete admin, CASCADE évite l'orphelin).
 */
export class CreateOrganizationAccountingConfigs1700000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "organization_accounting_configs" (
        "organization_id" UUID        PRIMARY KEY,
        "system"          TEXT        NOT NULL,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_organization_accounting_configs_organization"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_organization_accounting_configs_system"
          CHECK ("system" IN ('NORMAL', 'MINIMAL', 'ALLEGE'))
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_accounting_configs"`);
  }
}
