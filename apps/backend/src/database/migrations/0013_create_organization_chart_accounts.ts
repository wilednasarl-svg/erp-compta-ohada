import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-PC-03 — `organization_chart_accounts` : plan comptable
 * personnalisable par organisation.
 *
 * À la création d'une organisation, le `ChartOfAccountsService` clone
 * toutes les lignes de `reference_chart_accounts` applicables au
 * système choisi vers cette table. L'organisation peut ensuite :
 *   - ajouter des sous-comptes (4-10 chiffres) sous un nœud existant ;
 *   - désactiver des comptes (`is_active = false`) qu'elle n'utilise pas ;
 *   - modifier les libellés (mais jamais le `code`).
 *
 * `reference_account_id` :
 *   - NOT NULL → le compte vient du référentiel SYSCOHADA officiel
 *     (immuable côté API, seul `label` + `is_active` éditables) ;
 *   - NULL → compte créé par l'organisation (custom), supprimable si
 *     aucun enfant actif (et plus tard : aucune écriture, Module 3).
 *
 * `parent_id` est self-referencing et matérialise l'arbre. Préfixe
 * strict : si `parent.code = '41'` alors `child.code` DOIT commencer
 * par `'41'` et être strictement plus long. La règle de préfixe est
 * enforced applicativement (`ChartOfAccountsService.createCustomAccount`)
 * + une CHECK SQL légère qui vérifie au moins la cohérence "code
 * non-vide et plus long que parent.code" via trigger laissé en suivi.
 *
 * Indexes :
 *   - `UNIQUE(organization_id, code)` — un code est unique au sein
 *     d'une organisation (deux orgs peuvent avoir leur propre `4111`).
 *   - `(organization_id, class)` — listes filtrées par classe.
 *   - `(organization_id, parent_id)` — chargement d'arbre par
 *     niveau (`WHERE parent_id = $1`).
 *   - `(organization_id, is_active)` — listes "actif uniquement".
 */
export class CreateOrganizationChartAccounts1700000000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "organization_chart_accounts" (
        "id"                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"      UUID        NOT NULL,
        "code"                 TEXT        NOT NULL,
        "label"                TEXT        NOT NULL,
        "class"                SMALLINT    NOT NULL,
        "account_type"         TEXT        NOT NULL,
        "normal_balance"       CHAR(1)     NOT NULL,
        "parent_id"            UUID        NULL,
        "reference_account_id" UUID        NULL,
        "is_active"            BOOLEAN     NOT NULL DEFAULT true,
        "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_organization_chart_accounts_organization"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_organization_chart_accounts_parent"
          FOREIGN KEY ("parent_id")
          REFERENCES "organization_chart_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_organization_chart_accounts_reference"
          FOREIGN KEY ("reference_account_id")
          REFERENCES "reference_chart_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "uq_organization_chart_accounts_org_code"
          UNIQUE ("organization_id", "code"),
        CONSTRAINT "chk_organization_chart_accounts_code"
          CHECK ("code" ~ '^[0-9]{1,10}$'),
        CONSTRAINT "chk_organization_chart_accounts_class"
          CHECK ("class" BETWEEN 1 AND 9),
        CONSTRAINT "chk_organization_chart_accounts_account_type"
          CHECK ("account_type" IN ('TITLE', 'POSTING')),
        CONSTRAINT "chk_organization_chart_accounts_normal_balance"
          CHECK ("normal_balance" IN ('D', 'C'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_organization_chart_accounts_org_class"
        ON "organization_chart_accounts" ("organization_id", "class")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_organization_chart_accounts_org_parent"
        ON "organization_chart_accounts" ("organization_id", "parent_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_organization_chart_accounts_org_active"
        ON "organization_chart_accounts" ("organization_id", "is_active")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_chart_accounts"`);
  }
}
