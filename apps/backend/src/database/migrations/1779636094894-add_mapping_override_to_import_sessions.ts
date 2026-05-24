import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddMappingOverrideToImportSessions1779636094894 implements MigrationInterface {
  name = 'AddMappingOverrideToImportSessions1779636094894';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "import_sessions" ADD COLUMN IF NOT EXISTS "mapping_override" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "rule_executions" ADD COLUMN IF NOT EXISTS "matches_snapshot" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rule_executions" DROP COLUMN IF EXISTS "matches_snapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "import_sessions" DROP COLUMN IF EXISTS "mapping_override"`,
    );
  }
}
