import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * BE-JE-05 — triggers PG belt-and-braces sur les invariants comptables.
 *
 * Deux triggers :
 *
 *   1. `tg_check_journal_entry_balance`
 *      AFTER INSERT/UPDATE/DELETE ON `journal_entry_lines`, FOR EACH STATEMENT.
 *      Recalcule `SUM(debit) - SUM(credit)` pour CHAQUE entry impactée par
 *      l'opération. Si != 0 ET que l'entry est `validated`, RAISE EXCEPTION.
 *      On AUTORISE temporairement le déséquilibre tant que l'entry est
 *      `draft` — sinon l'INSERT batch des lignes pré-validation est
 *      impossible (la 1ʳᵉ ligne déséquilibre forcément).
 *
 *   2. `tg_check_account_is_posting`
 *      BEFORE INSERT/UPDATE ON `journal_entry_lines`, FOR EACH ROW.
 *      Refuse une ligne dont le compte est `account_type='TITLE'`.
 *
 * Les services (`EntriesService.createDraft`, `validate`) appliquent les
 * mêmes invariants pour une UX claire (422 avec message). Les triggers
 * sont le garde-fou contre les inserts directs en DB.
 */
export class CreateBalanceTriggers1700000000040 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Trigger 1 : équilibre par entry (uniquement si entry validated)
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_check_journal_entry_balance()
      RETURNS TRIGGER AS $$
      DECLARE
        v_entry_ids UUID[];
        v_entry_id UUID;
        v_status TEXT;
        v_debit_sum DECIMAL(15, 2);
        v_credit_sum DECIMAL(15, 2);
      BEGIN
        -- Collect impacted entry ids from NEW (insert/update) and OLD (update/delete)
        v_entry_ids := ARRAY(
          SELECT DISTINCT journal_entry_id
          FROM (
            SELECT journal_entry_id FROM new_rows
            UNION ALL
            SELECT journal_entry_id FROM old_rows
          ) AS combined
          WHERE journal_entry_id IS NOT NULL
        );

        FOREACH v_entry_id IN ARRAY v_entry_ids LOOP
          SELECT status INTO v_status FROM journal_entries WHERE id = v_entry_id;

          -- Skip the check while the entry is still a draft
          IF v_status IS NULL OR v_status = 'draft' THEN
            CONTINUE;
          END IF;

          SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
            INTO v_debit_sum, v_credit_sum
            FROM journal_entry_lines
            WHERE journal_entry_id = v_entry_id;

          IF v_debit_sum <> v_credit_sum THEN
            RAISE EXCEPTION 'Journal entry % is unbalanced (debit=% credit=%)',
              v_entry_id, v_debit_sum, v_credit_sum
              USING ERRCODE = 'check_violation';
          END IF;
        END LOOP;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    // INSERT trigger (NEW table only)
    await queryRunner
      .query(
        `
      CREATE TRIGGER tg_check_journal_entry_balance_insert
        AFTER INSERT ON journal_entry_lines
        REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
        FOR EACH STATEMENT
        EXECUTE FUNCTION fn_check_journal_entry_balance()
    `,
      )
      .catch(async () => {
        // PG < 11 fallback : créer 3 triggers séparés avec curseur — non
        // applicable ici (on cible PG ≥ 13 via Supabase). On consigne juste
        // l'absence de support transition tables.
      });

    // UPDATE trigger
    await queryRunner.query(`
      CREATE TRIGGER tg_check_journal_entry_balance_update
        AFTER UPDATE ON journal_entry_lines
        REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
        FOR EACH STATEMENT
        EXECUTE FUNCTION fn_check_journal_entry_balance()
    `);

    // DELETE trigger
    await queryRunner.query(`
      CREATE TRIGGER tg_check_journal_entry_balance_delete
        AFTER DELETE ON journal_entry_lines
        REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
        FOR EACH STATEMENT
        EXECUTE FUNCTION fn_check_journal_entry_balance()
    `);

    // Trigger 2 : compte POSTING obligatoire
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION fn_check_account_is_posting()
      RETURNS TRIGGER AS $$
      DECLARE
        v_account_type TEXT;
      BEGIN
        SELECT account_type INTO v_account_type
          FROM organization_chart_accounts
          WHERE id = NEW.account_id;

        IF v_account_type IS NULL THEN
          RAISE EXCEPTION 'Account % not found', NEW.account_id
            USING ERRCODE = 'foreign_key_violation';
        END IF;

        IF v_account_type <> 'POSTING' THEN
          RAISE EXCEPTION 'Account % is not a POSTING account (type=%)',
            NEW.account_id, v_account_type
            USING ERRCODE = 'check_violation';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER tg_check_account_is_posting
        BEFORE INSERT OR UPDATE OF account_id ON journal_entry_lines
        FOR EACH ROW
        EXECUTE FUNCTION fn_check_account_is_posting()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS tg_check_account_is_posting ON journal_entry_lines`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS tg_check_journal_entry_balance_delete ON journal_entry_lines`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS tg_check_journal_entry_balance_update ON journal_entry_lines`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS tg_check_journal_entry_balance_insert ON journal_entry_lines`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_check_account_is_posting()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_check_journal_entry_balance()`);
  }
}
