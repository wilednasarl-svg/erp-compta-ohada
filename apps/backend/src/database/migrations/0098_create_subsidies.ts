import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W4.4 — `subsidies` + `subsidy_releases` : subventions d'investissement
 * SYSCOHADA (Tome 2 chap. 17, App. 66).
 *
 * Doctrine :
 *   - Octroi  : D 4494 (subv à recevoir) ou 521 (banque) / C 1411
 *               (subvention d'investissement reçue).
 *   - Reprise : à chaque exercice, on transfère au compte de résultat
 *               une quote-part de la subvention au rythme de
 *               l'amortissement de l'asset financé :
 *                   D 1411 / C 799 (subvention virée au résultat)
 *               Pour un asset non amortissable (terrains, fonds), la
 *               reprise est étalée linéairement sur 10 ans.
 *
 * `journal_entry_id_grant` : référence l'écriture d'octroi posée par
 * EntriesService. SET NULL si l'écriture est plus tard contre-passée
 * (la subvention reste en tant que registre métier).
 *
 * `subsidy_releases` capture chaque reprise effectuée (mensuelle pour
 * `linear_10y`, annuelle pour `on_depreciation` à chaque dotation
 * postée, libre pour `manual`). `related_depreciation_schedule_id`
 * trace le lien vers la dotation qui a déclenché la reprise (audit).
 *
 * Permissions `subsidies.read` / `subsidies.write` sont seedées dans la
 * même migration.
 */
export class CreateSubsidies1700000000098 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Table subsidies ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subsidies" (
        "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"          UUID         NOT NULL,
        "asset_id"                 UUID,
        "grantor_name"             TEXT         NOT NULL,
        "grant_date"               DATE         NOT NULL,
        "total_amount"             NUMERIC(15,2) NOT NULL,
        "released_amount"          NUMERIC(15,2) NOT NULL DEFAULT 0,
        "release_method"           TEXT         NOT NULL,
        "status"                   TEXT         NOT NULL DEFAULT 'active',
        "journal_entry_id_grant"   UUID,
        "note"                     TEXT,
        "created_by_id"            UUID,
        "closed_at"                TIMESTAMPTZ,
        "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_subsidies" PRIMARY KEY ("id"),
        CONSTRAINT "fk_subsidies_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_subsidies_asset"
          FOREIGN KEY ("asset_id")
          REFERENCES "assets" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_subsidies_journal_entry_grant"
          FOREIGN KEY ("journal_entry_id_grant")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_subsidies_release_method"
          CHECK ("release_method" IN ('on_depreciation', 'linear_10y', 'manual')),
        CONSTRAINT "chk_subsidies_status"
          CHECK ("status" IN ('active', 'fully_released', 'cancelled')),
        CONSTRAINT "chk_subsidies_total_positive"
          CHECK ("total_amount" > 0),
        CONSTRAINT "chk_subsidies_released_nonneg"
          CHECK ("released_amount" >= 0),
        CONSTRAINT "chk_subsidies_released_le_total"
          CHECK ("released_amount" <= "total_amount")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_subsidies_org_status"
        ON "subsidies" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_subsidies_org_asset"
        ON "subsidies" ("organization_id", "asset_id")
    `);

    // ─── Table subsidy_releases ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subsidy_releases" (
        "id"                                UUID         NOT NULL DEFAULT gen_random_uuid(),
        "subsidy_id"                        UUID         NOT NULL,
        "organization_id"                   UUID         NOT NULL,
        "release_date"                      DATE         NOT NULL,
        "amount"                            NUMERIC(15,2) NOT NULL,
        "journal_entry_id"                  UUID,
        "related_depreciation_schedule_id"  UUID,
        "created_by_id"                     UUID,
        "created_at"                        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_subsidy_releases" PRIMARY KEY ("id"),
        CONSTRAINT "fk_subsidy_releases_subsidy"
          FOREIGN KEY ("subsidy_id")
          REFERENCES "subsidies" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_subsidy_releases_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_subsidy_releases_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_subsidy_releases_amount_positive"
          CHECK ("amount" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_subsidy_releases_subsidy"
        ON "subsidy_releases" ("subsidy_id", "release_date" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_subsidy_releases_org_date"
        ON "subsidy_releases" ("organization_id", "release_date" DESC)
    `);

    // ─── RBAC permissions ─────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('subsidies.read',  'Read investment subsidies register'),
        ('subsidies.write', 'Create subsidies and post grant / release entries')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'subsidies.read'),
        ('admin',            'subsidies.write'),
        ('expert_comptable', 'subsidies.read'),
        ('expert_comptable', 'subsidies.write'),
        ('chef_mission',     'subsidies.read'),
        ('chef_mission',     'subsidies.write'),
        ('comptable',        'subsidies.read'),
        ('comptable',        'subsidies.write'),
        ('auditeur',         'subsidies.read'),
        ('client_readonly',  'subsidies.read')
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
        WHERE "code" IN ('subsidies.read', 'subsidies.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('subsidies.read', 'subsidies.write')
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "subsidy_releases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subsidies"`);
  }
}
