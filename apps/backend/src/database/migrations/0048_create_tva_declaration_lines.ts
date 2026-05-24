import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-TVA-03 — `tva_declaration_lines` : détail d'agrégation d'une déclaration.
 *
 * Une ligne = (direction, account_prefix, montant). Cascade DELETE sur la
 * déclaration parente : on recompute toute la déclaration plutôt que de
 * patcher des lignes individuelles, donc supprimer en bloc est sûr.
 *
 * `account_prefix` est le préfixe SYSCOHADA utilisé pour l'agrégation
 * (ex `4431`, `4452`, `4451`). Pas de FK car ce n'est pas un compte du
 * plan : c'est un libellé de groupe.
 */
export class CreateTvaDeclarationLines1700000000048 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tva_declaration_lines" (
        "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
        "declaration_id"  UUID          NOT NULL,
        "direction"       TEXT          NOT NULL,
        "account_prefix"  TEXT          NOT NULL,
        "account_label"   TEXT,
        "amount"          NUMERIC(15,2) NOT NULL DEFAULT 0,
        "created_at"      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tva_declaration_lines" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tva_declaration_lines_declaration"
          FOREIGN KEY ("declaration_id")
          REFERENCES "tva_declarations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_tva_declaration_lines_direction"
          CHECK ("direction" IN ('collected', 'deductible_bs', 'deductible_immo')),
        CONSTRAINT "chk_tva_declaration_lines_amount_non_negative"
          CHECK ("amount" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_tva_declaration_lines_declaration"
        ON "tva_declaration_lines" ("declaration_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tva_declaration_lines"`);
  }
}
