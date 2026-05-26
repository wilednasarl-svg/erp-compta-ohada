import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * d17.26 — Événements postérieurs à la clôture (W5.7).
 *
 * Capture les événements survenus entre la date de clôture d'un exercice
 * et la date d'arrêté des comptes. La doctrine SYSCOHADA (Tome 3,
 * Note 35) impose de :
 *
 *   1. Les CLASSER : ajustant (apporte une information sur une situation
 *      pré-existante à la date de clôture → corrige les comptes) vs.
 *      non-ajustant (situation née APRÈS la clôture → simple disclosure).
 *   2. Les DISCLOSER dans la note annexe 35 si non-ajustant matériel.
 *   3. Les COMPTABILISER si ajustant (passe-écriture sur l'exercice
 *      clos avant arrêté).
 *
 * Cette table sert de back-end structuré au remplissage de la N35 :
 * une fois cette table peuplée, le handler N35 lit les événements pour
 * générer les rows au lieu d'un simple free-comment.
 *
 *   - `event_date`      : date réelle de l'événement (≥ date de clôture).
 *   - `classification`  : ADJUSTING | NON_ADJUSTING.
 *   - `description`     : libellé qualitatif (qu'est-ce qui s'est passé).
 *   - `financial_impact`: estimation monétaire DECIMAL(15,2). NULL si
 *     non quantifiable (ex. risque juridique en cours).
 *   - `journal_entry_id`: lien à l'écriture de redressement si ADJUSTING
 *     déjà comptabilisée. NULL pour NON_ADJUSTING ou ADJUSTING pending.
 *   - `created_by_id`   : utilisateur ayant saisi l'événement.
 *   - `reviewed_by_id`  : second utilisateur ayant validé la
 *     classification (workflow à 4 yeux).
 */
export class CreateSubsequentEvents1700000000102 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "subsequent_events" (
        "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID        NOT NULL,
        "exercise_id"      UUID        NOT NULL,
        "event_date"       DATE        NOT NULL,
        "classification"   TEXT        NOT NULL,
        "description"      TEXT        NOT NULL,
        "financial_impact" NUMERIC(15,2),
        "journal_entry_id" UUID,
        "created_by_id"    UUID        NOT NULL,
        "reviewed_by_id"   UUID,
        "reviewed_at"      TIMESTAMPTZ,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_subsequent_events" PRIMARY KEY ("id"),
        CONSTRAINT "fk_subsequent_events_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_subsequent_events_exercise"
          FOREIGN KEY ("exercise_id")
          REFERENCES "accounting_periods" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_subsequent_events_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_subsequent_events_classification"
          CHECK ("classification" IN ('ADJUSTING', 'NON_ADJUSTING')),
        CONSTRAINT "chk_subsequent_events_description_non_empty"
          CHECK (length(btrim("description")) > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_subsequent_events_org_exercise"
        ON "subsequent_events" ("organization_id", "exercise_id", "event_date")
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "subsequent_events"
        IS 'W5.7 — événements postérieurs à la clôture (SYSCOHADA Note 35). Classés ADJUSTING/NON_ADJUSTING.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "subsequent_events"`);
  }
}
