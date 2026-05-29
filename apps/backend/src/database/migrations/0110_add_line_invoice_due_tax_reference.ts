import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Étend `journal_entry_lines` avec les métadonnées de pièce portées par
 * le modèle d'import journal (Sage) — colonnes mappées mais jusqu'ici
 * non persistées au niveau ligne. Débloque trois usages métier :
 *
 *   - `invoice_number` VARCHAR(50)  NULL — N° facture. Support du
 *     lettrage par facture (rapprochement client/fournisseur).
 *   - `due_date`       DATE         NULL — date d'échéance. Alimente
 *     l'échéancier fournisseur / créances.
 *   - `tax_code`       VARCHAR(20)  NULL — code taxe (TVA). Base de la
 *     ventilation TVA par ligne.
 *   - `reference`      VARCHAR(100) NULL — référence libre de la ligne
 *     (distincte de la référence d'écriture = N° pièce).
 *
 * Toutes nullable — aucune écriture existante n'est impactée. Deux index
 * partiels accélèrent les requêtes métier visées (lettrage par facture,
 * échéancier), sans coût sur les lignes qui ne portent pas la donnée.
 *
 * down() : DROP des index puis des colonnes.
 */
export class AddLineInvoiceDueTaxReference1700000000110 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        ADD COLUMN IF NOT EXISTS "invoice_number" VARCHAR(50),
        ADD COLUMN IF NOT EXISTS "due_date"       DATE,
        ADD COLUMN IF NOT EXISTS "tax_code"       VARCHAR(20),
        ADD COLUMN IF NOT EXISTS "reference"      VARCHAR(100)
    `);

    // Lettrage par facture : retrouver toutes les lignes d'une facture
    // dans un tenant. Partiel — seules les lignes facturées sont indexées.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_jel_org_invoice_number"
        ON "journal_entry_lines" ("organization_id", "invoice_number")
        WHERE "invoice_number" IS NOT NULL
    `);

    // Échéancier : balayer les lignes par date d'échéance dans un tenant.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_jel_org_due_date"
        ON "journal_entry_lines" ("organization_id", "due_date")
        WHERE "due_date" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_jel_org_due_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_jel_org_invoice_number"`);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        DROP COLUMN IF EXISTS "reference",
        DROP COLUMN IF EXISTS "tax_code",
        DROP COLUMN IF EXISTS "due_date",
        DROP COLUMN IF EXISTS "invoice_number"
    `);
  }
}
