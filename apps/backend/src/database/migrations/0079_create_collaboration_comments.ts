import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-COLLAB-02 — `collaboration_comments` : messages attachés à une
 * demande de justificatif (Module 21 wave 1).
 *
 * Immutable en wave 1 (pas de `deleted_at` ni `updated_at`). L'édition
 * et la modération arriveront en wave 2 avec une nouvelle permission
 * `collaboration.moderate`.
 *
 * `organization_id` est dénormalisé pour permettre les filtres
 * multi-tenant directs sans jointure systématique avec la table mère.
 * Une CHECK valide la cohérence org_id ↔ request via FK composite.
 */
export class CreateCollaborationComments1700000000079 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collaboration_comments" (
        "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"  UUID         NOT NULL,
        "request_id"       UUID         NOT NULL,
        "author_id"        UUID         NOT NULL,
        "body"             TEXT         NOT NULL,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_collaboration_comments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_collab_comments_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_collab_comments_request"
          FOREIGN KEY ("request_id")
          REFERENCES "collaboration_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_collab_comments_author"
          FOREIGN KEY ("author_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_collab_comments_body_not_blank"
          CHECK (char_length(btrim("body")) > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_collab_comments_request_created"
        ON "collaboration_comments" ("request_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_collab_comments_org_author"
        ON "collaboration_comments" ("organization_id", "author_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "collaboration_comments"`);
  }
}
