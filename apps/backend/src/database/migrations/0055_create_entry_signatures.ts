import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Module 14 wave 1 — `entry_signatures`.
 *
 * Stocke chaque signature électronique apposée sur une écriture journal:
 *
 *  - `signer_role` : 'chef_mission' (revue) ou 'expert_comptable' (signature finale).
 *  - `signature_hash` : SHA-256 hex (64 chars) sur le payload immuable
 *      (entry header + lignes ordonnées). Permet la détection de
 *      modification a posteriori si on rejouait la chaîne d'audit.
 *  - `journal_entry_id` : FK ON DELETE RESTRICT — on n'efface pas une
 *      entry signée par cascade silencieuse.
 *  - `signed_at` : timestamp UTC posé serveur.
 *
 * UNIQUE (entry_id, signer_role) : un seul chef_mission et un seul
 * expert_comptable par entry. Resigner après rejet impose de purger la
 * row précédente (down-step) — non exposé en wave 1.
 */
export class CreateEntrySignatures1700000000055 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "entry_signatures" (
        "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID         NOT NULL,
        "journal_entry_id" UUID         NOT NULL,
        "signer_id"        UUID         NOT NULL,
        "signer_role"      TEXT         NOT NULL,
        "signature_hash"   TEXT         NOT NULL,
        "comment"          TEXT,
        "signed_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_entry_signatures" PRIMARY KEY ("id"),
        CONSTRAINT "fk_entry_signatures_org"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_entry_signatures_entry"
          FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_entry_signatures_signer"
          FOREIGN KEY ("signer_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_entry_signatures_entry_role"
          UNIQUE ("journal_entry_id", "signer_role"),
        CONSTRAINT "chk_entry_signatures_role"
          CHECK ("signer_role" IN ('chef_mission', 'expert_comptable')),
        CONSTRAINT "chk_entry_signatures_hash"
          CHECK (char_length("signature_hash") = 64)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_entry_signatures_org_entry"
        ON "entry_signatures" ("organization_id", "journal_entry_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_entry_signatures_org_signer"
        ON "entry_signatures" ("organization_id", "signer_id", "signed_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "entry_signatures"`);
  }
}
