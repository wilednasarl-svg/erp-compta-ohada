import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * W3.1 — `provisions` + `provision_movements` : registre SYSCOHADA
 * des provisions pour risques et charges (chap. 18 + 21 du tome
 * "operations specifiques"). Une `provisions` row = un risque
 * provisionne (un litige, une garantie, etc.). Le journal des
 * mouvements (`provision_movements`) trace dotations / reprises /
 * utilisations dans le temps, avec un lien optionnel vers l'écriture
 * comptable générée côté Module 8.
 *
 * Comptes SYSCOHADA agités (mapping figé côté `provision.types.ts`,
 * pas en DB — un changement de plan comptable ne casse pas la table) :
 *
 *   type             | provision | dotation | reprise
 *   -----------------+-----------+----------+--------
 *   litige           | 191       | 6911     | 7911
 *   garantie         | 192       | 6911     | 7911
 *   restructuration  | 193       | 6912     | 7912
 *   perte_change     | 194       | 6971     | 7971
 *   retraite         | 196       | 6913     | 7913
 *   demantelement    | 1984      | 6915     | 7915
 *
 * `current_amount` peut tomber a 0 mais jamais devenir negatif : le
 * service refuse une reprise/utilisation qui depasse le solde. Le
 * CHECK garantit l'invariant cote DB.
 *
 * `journal_entry_id` est NULLABLE : une `utilization` (paiement reel
 * absorbe par la provision) ne genere pas d'ecriture cote provisions
 * — l'ecriture du paiement est posee par le module concerne (banque,
 * paie...). Le mouvement provision sert juste a decrementer le solde
 * et conserver la trace.
 *
 * Permissions `provisions.read` / `provisions.write` ajoutees dans la
 * meme migration pour eviter une migration RBAC orpheline.
 */
export class CreateProvisions1700000000094 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Table provisions ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "provisions" (
        "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id"   UUID         NOT NULL,
        "type"              TEXT         NOT NULL,
        "account_code"      VARCHAR(10)  NOT NULL,
        "label"             TEXT         NOT NULL,
        "initial_amount"    NUMERIC(15,2) NOT NULL,
        "current_amount"    NUMERIC(15,2) NOT NULL,
        "status"            TEXT         NOT NULL DEFAULT 'active',
        "created_by_id"     UUID,
        "closed_by_id"      UUID,
        "closed_at"         TIMESTAMPTZ,
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_provisions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_provisions_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_provisions_type"
          CHECK ("type" IN (
            'litige', 'garantie', 'restructuration',
            'demantelement', 'retraite', 'perte_change'
          )),
        CONSTRAINT "chk_provisions_status"
          CHECK ("status" IN ('active', 'cancelled', 'closed')),
        CONSTRAINT "chk_provisions_initial_positive"
          CHECK ("initial_amount" > 0),
        CONSTRAINT "chk_provisions_current_nonneg"
          CHECK ("current_amount" >= 0),
        CONSTRAINT "chk_provisions_closed_consistent"
          CHECK (
            ("status" IN ('closed', 'cancelled') AND "closed_at" IS NOT NULL)
            OR ("status" = 'active' AND "closed_at" IS NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_provisions_org_status"
        ON "provisions" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_provisions_org_type"
        ON "provisions" ("organization_id", "type")
    `);

    // ─── Table provision_movements ────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "provision_movements" (
        "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
        "provision_id"      UUID         NOT NULL,
        "organization_id"   UUID         NOT NULL,
        "kind"              TEXT         NOT NULL,
        "amount"            NUMERIC(15,2) NOT NULL,
        "journal_entry_id"  UUID,
        "effective_date"    DATE         NOT NULL,
        "note"              TEXT,
        "created_by_id"     UUID,
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_provision_movements" PRIMARY KEY ("id"),
        CONSTRAINT "fk_provision_movements_provision"
          FOREIGN KEY ("provision_id")
          REFERENCES "provisions" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_provision_movements_org"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_provision_movements_journal_entry"
          FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_provision_movements_kind"
          CHECK ("kind" IN ('dotation', 'reprise', 'utilization')),
        CONSTRAINT "chk_provision_movements_amount_positive"
          CHECK ("amount" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_provision_movements_provision"
        ON "provision_movements" ("provision_id", "effective_date" DESC, "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_provision_movements_org_kind"
        ON "provision_movements" ("organization_id", "kind", "effective_date" DESC)
    `);

    // ─── RBAC permissions ─────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "permissions" ("code", "description") VALUES
        ('provisions.read',  'Read provisions for risks and charges register'),
        ('provisions.write', 'Create / dotate / reprise / utilize / close provisions')
      ON CONFLICT ("code") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      JOIN "permissions" p ON TRUE
      JOIN (VALUES
        ('admin',            'provisions.read'),
        ('admin',            'provisions.write'),
        ('expert_comptable', 'provisions.read'),
        ('expert_comptable', 'provisions.write'),
        ('chef_mission',     'provisions.read'),
        ('chef_mission',     'provisions.write'),
        ('comptable',        'provisions.read'),
        ('comptable',        'provisions.write'),
        ('auditeur',         'provisions.read'),
        ('client_readonly',  'provisions.read')
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
        WHERE "code" IN ('provisions.read', 'provisions.write')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "code" IN ('provisions.read', 'provisions.write')
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "provision_movements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "provisions"`);
  }
}
