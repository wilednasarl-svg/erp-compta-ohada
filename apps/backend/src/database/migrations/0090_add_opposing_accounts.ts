import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W1.4 — Comptes opposants (`is_opposing`) sur le plan comptable.
 *
 * Tome 1 OHADA, gap G02 : certaines sous-classes ont un **sens normal
 * opposé** à celui de leur classe parente. Inscrire leur solde au
 * "même titre" que les autres comptes du poste fausserait le bilan :
 * il faut les présenter EN DÉDUCTION du poste cible.
 *
 * Sous-classes / comptes flaggés `is_opposing = true` :
 *   - 29x : dépréciations des comptes d'immobilisations (classe 2,
 *           sens normal débiteur → 29x est créditeur, en déduction
 *           de l'actif immobilisé brut).
 *   - 39x : dépréciations des stocks (classe 3, idem).
 *   - 49x : dépréciations des comptes de tiers (classe 4 mixte ;
 *           49x est créditeur en déduction des créances clients).
 *   - 59x : dépréciations des comptes de placement (classe 5, idem).
 *   - 109 : Actionnaires, capital souscrit non appelé (classe 1
 *           créditrice ; 109 est débiteur, en déduction du capital
 *           appelé inscrit en 101).
 *   - 121 : Report à nouveau débiteur (en déduction des capitaux
 *           propres).
 *   - 129 : Résultat net déficitaire (en déduction).
 *   - 409 : Fournisseurs débiteurs, avances et acomptes versés
 *           (classe 4 créditrice côté fournisseurs ; 409 est
 *           débiteur, à reclasser à l'actif).
 *
 * La règle de présentation au Bilan / Compte de résultat appliquée
 * par `classifyForBilan` + `computeBalanceSheetBare` : pour un
 * compte `is_opposing = true`, on inverse le `netSign` avant le
 * classement de section ; le montant absolu reste positif mais
 * vient EN DÉDUCTION du total de la section parent (l'opposé du
 * sens classique).
 *
 * Implémentation : ajout d'une colonne BOOLEAN NOT NULL DEFAULT
 * false sur `reference_chart_accounts` et `organization_chart_accounts`
 * (table miroir tenant). Backfill par préfixes de code SYSCOHADA.
 * Pas d'index — la lecture est jointe à `accountBalancesAsAt` qui
 * scanne déjà la table en entier par tenant.
 */
export class AddOpposingAccounts1700000000090 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. reference_chart_accounts ----------------------------------------
    await queryRunner.query(`
      ALTER TABLE "reference_chart_accounts"
        ADD COLUMN IF NOT EXISTS "is_opposing" BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "reference_chart_accounts"."is_opposing"
        IS 'true → le compte a un sens normal opposé à sa classe parente (dépréciations 29x/39x/49x/59x, 109, 121, 129, 409). Son solde vient en déduction du poste au Bilan, jamais en addition.'
    `);
    await queryRunner.query(`
      UPDATE "reference_chart_accounts"
        SET "is_opposing" = true
        WHERE "code" LIKE '29%'
           OR "code" LIKE '39%'
           OR "code" LIKE '49%'
           OR "code" LIKE '59%'
           OR "code" IN ('109', '121', '129', '409')
    `);

    // 2. organization_chart_accounts (tenant mirror) ---------------------
    await queryRunner.query(`
      ALTER TABLE "organization_chart_accounts"
        ADD COLUMN IF NOT EXISTS "is_opposing" BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "organization_chart_accounts"."is_opposing"
        IS 'Hérité de reference_chart_accounts.is_opposing lors du clone du plan à la création de l''organisation. Voir migration 0090.'
    `);
    // Backfill via la FK vers reference_chart_accounts (les comptes
    // clonés ont reference_account_id non-null) ; pour les comptes
    // custom (reference_account_id = NULL) on backfille aussi par
    // préfixe — un compte custom 4912xxxx reste une dépréciation.
    await queryRunner.query(`
      UPDATE "organization_chart_accounts" AS oca
        SET "is_opposing" = true
        FROM "reference_chart_accounts" AS rca
        WHERE oca."reference_account_id" = rca."id"
          AND rca."is_opposing" = true
    `);
    await queryRunner.query(`
      UPDATE "organization_chart_accounts"
        SET "is_opposing" = true
        WHERE "reference_account_id" IS NULL
          AND (
               "code" LIKE '29%'
            OR "code" LIKE '39%'
            OR "code" LIKE '49%'
            OR "code" LIKE '59%'
            OR "code" IN ('109', '121', '129', '409')
          )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organization_chart_accounts"
        DROP COLUMN IF EXISTS "is_opposing"
    `);
    await queryRunner.query(`
      ALTER TABLE "reference_chart_accounts"
        DROP COLUMN IF EXISTS "is_opposing"
    `);
  }
}
