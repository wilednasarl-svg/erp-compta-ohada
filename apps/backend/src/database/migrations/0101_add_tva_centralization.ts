import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W4.1 — Centralisation TVA : étend `tva_declarations` avec deux colonnes
 * pour traquer l'écriture de centralisation générée à partir d'une
 * déclaration `calculated`.
 *
 * Doctrine (Tome 1 G08, R15) : à la fin de la période de TVA, les comptes
 * 443 (collectée) et 445x (déductibles) sont soldés vers 4441 (TVA due)
 * ou 4449 (crédit reportable). Le service `TvaDeclarationsService.centralize`
 * matérialise cette écriture en journal `OD` puis enregistre l'ID ici pour
 * verrouiller une déclaration déjà centralisée (TVA_ALREADY_CENTRALIZED).
 *
 * `ON DELETE SET NULL` : si une purge supprime l'écriture (peu probable
 * en prod, mais possible en dev), la déclaration reste lisible avec un
 * historique d'audit pour reconstituer l'opération.
 */
export class AddTvaCentralization1700000000101 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tva_declarations"
        ADD COLUMN "centralization_journal_entry_id" UUID NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "tva_declarations"
        ADD CONSTRAINT "fk_tva_declarations_centralization_entry"
        FOREIGN KEY ("centralization_journal_entry_id")
        REFERENCES "journal_entries" ("id")
        ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "tva_declarations"
        ADD COLUMN "centralized_at" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tva_declarations"
        DROP CONSTRAINT IF EXISTS "fk_tva_declarations_centralization_entry"
    `);
    await queryRunner.query(`
      ALTER TABLE "tva_declarations"
        DROP COLUMN IF EXISTS "centralized_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "tva_declarations"
        DROP COLUMN IF EXISTS "centralization_journal_entry_id"
    `);
  }
}
