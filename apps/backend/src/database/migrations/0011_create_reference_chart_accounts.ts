import { type MigrationInterface, type QueryRunner } from 'typeorm';

import { OHADA_REFERENCE_CHART } from '../../modules/accounting-plan/seed/ohada-syscohada-audcif';

/**
 * BE-PC-01 — `reference_chart_accounts` : plan comptable OHADA
 * SYSCOHADA AUDCIF de référence.
 *
 * Table **globale** (non-tenant-scopée) — c'est le catalogue officiel
 * partagé par toutes les organisations. Aucune écriture API ne modifie
 * cette table ; elle évolue uniquement par migration quand la
 * réglementation OHADA évolue (rare). Le repo `ReferenceAccountRepository`
 * n'expose donc qu'une API lecture.
 *
 * Indexes :
 *   - `UNIQUE(code)` — un code SYSCOHADA est unique par définition.
 *   - `(class)` — la requête dominante est "liste-moi tous les comptes
 *     de classe 6" pour la présentation arborescente côté UI.
 *   - `GIN(applicable_systems)` — `WHERE 'NORMAL' = ANY(applicable_systems)`
 *     pour le clone du plan vers une organisation.
 *
 * Le seed est inséré inline (~∼160 lignes pour la colonne vertébrale ;
 * le scope SYSCOHADA complet de ∼800 lignes sera ajouté par migrations
 * additives 0011a / 0011b sans toucher au schéma).
 */
export class CreateReferenceChartAccounts1700000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // pgcrypto est déjà actif (0001) — re-déclaré idempotent.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "reference_chart_accounts" (
        "id"                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "code"                TEXT        NOT NULL,
        "label"               TEXT        NOT NULL,
        "class"               SMALLINT    NOT NULL,
        "account_type"        TEXT        NOT NULL,
        "normal_balance"      CHAR(1)     NOT NULL,
        "applicable_systems"  TEXT[]      NOT NULL,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_reference_chart_accounts_code" UNIQUE ("code"),
        CONSTRAINT "chk_reference_chart_accounts_code"
          CHECK ("code" ~ '^[0-9]{1,10}$'),
        CONSTRAINT "chk_reference_chart_accounts_class"
          CHECK ("class" BETWEEN 1 AND 9),
        CONSTRAINT "chk_reference_chart_accounts_account_type"
          CHECK ("account_type" IN ('TITLE', 'POSTING')),
        CONSTRAINT "chk_reference_chart_accounts_normal_balance"
          CHECK ("normal_balance" IN ('D', 'C')),
        CONSTRAINT "chk_reference_chart_accounts_applicable_systems"
          CHECK (
            array_length("applicable_systems", 1) >= 1
            AND "applicable_systems" <@ ARRAY['NORMAL', 'MINIMAL', 'ALLEGE']::TEXT[]
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_reference_chart_accounts_class"
        ON "reference_chart_accounts" ("class")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_reference_chart_accounts_applicable_systems"
        ON "reference_chart_accounts" USING GIN ("applicable_systems")
    `);

    // Insertion du seed par batches de 100 — un INSERT unique de ∼800
    // lignes serait plus rapide mais moins lisible dans les logs si une
    // ligne casse une CHECK constraint pendant le développement.
    const BATCH_SIZE = 100;
    for (let offset = 0; offset < OHADA_REFERENCE_CHART.length; offset += BATCH_SIZE) {
      const batch = OHADA_REFERENCE_CHART.slice(offset, offset + BATCH_SIZE);
      // Build a single multi-row INSERT with parameterised values to keep
      // the migration replayable on Supabase / RDS (no string interpolation
      // of user data — even seed strings get parameterised).
      const placeholders: string[] = [];
      const values: unknown[] = [];
      batch.forEach((row, i) => {
        const base = i * 6;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
        );
        values.push(
          row.code,
          row.label,
          row.class,
          row.account_type,
          row.normal_balance,
          row.applicable_systems,
        );
      });
      await queryRunner.query(
        `INSERT INTO "reference_chart_accounts"
           ("code", "label", "class", "account_type", "normal_balance", "applicable_systems")
         VALUES ${placeholders.join(', ')}
         ON CONFLICT ("code") DO NOTHING`,
        values,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "reference_chart_accounts"`);
  }
}
