import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { authedJson, createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * E2E de l'endpoint de validité pré-génération (AC-V5) : il agrège, AVANT
 * génération, les seules écritures `validated` d'une période — compteur,
 * équilibre Σdébit−Σcrédit, dernier mouvement. Cible la partie la plus
 * risquée : la requête SQL réelle (filtre de statut, fenêtre de dates,
 * COUNT DISTINCT) contre un vrai Postgres.
 */
describe('e2e: Reports — validité pré-génération (AC-V5)', () => {
  let handle: E2eAppHandle;
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    handle = await createE2eApp();
    app = handle.app;
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTables(dataSource);
  });

  /** Borne un exercice annuel ouvert (référencé par les écritures). */
  async function seedPeriod(organizationId: string, periodId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO "accounting_periods" (
        "id", "organization_id", "parent_id", "kind", "label", "start_date", "end_date", "status"
      ) VALUES ($1, $2, null, 'ANNUAL', 'Exercice 2026', '2026-01-01', '2026-12-31', 'open')`,
      [periodId, organizationId],
    );
  }

  /**
   * Insère une écriture (lignes brutes) puis la force `validated` par SQL
   * direct. Forcer le statut permet de simuler aussi un journal corrompu
   * (lignes déséquilibrées) que la validation applicative refuserait.
   */
  async function seedValidatedEntry(
    organizationId: string,
    userId: string,
    opts: {
      readonly entryId: string;
      readonly periodId: string;
      readonly entryNumber: number;
      readonly entryDate: string;
      readonly lines: ReadonlyArray<{ code: string; debit: number; credit: number }>;
    },
  ): Promise<void> {
    const journal = (
      await dataSource.query(
        `SELECT "id" FROM "journals" WHERE "organization_id" = $1 AND "code" = 'OD' LIMIT 1`,
        [organizationId],
      )
    )[0];
    await dataSource.query(
      `INSERT INTO "journal_entries" (
        "id", "organization_id", "journal_id", "period_id", "entry_number",
        "description", "entry_date", "status", "created_by_id"
      ) VALUES ($1, $2, $3, $4, $5, 'E2E validité', $6, 'draft', $7)`,
      [
        opts.entryId,
        organizationId,
        journal.id,
        opts.periodId,
        opts.entryNumber,
        opts.entryDate,
        userId,
      ],
    );
    let position = 0;
    for (const line of opts.lines) {
      position += 1;
      await dataSource.query(
        `INSERT INTO "journal_entry_lines" (
          "id", "organization_id", "journal_entry_id", "account_id", "position", "debit", "credit", "description"
        ) VALUES (
          gen_random_uuid(), $1, $2,
          (SELECT "id" FROM "organization_chart_accounts" WHERE "organization_id" = $1 AND "code" = $3 LIMIT 1),
          $4, $5, $6, 'E2E'
        )`,
        [
          organizationId,
          opts.entryId,
          line.code,
          position,
          line.debit.toFixed(2),
          line.credit.toFixed(2),
        ],
      );
    }
    await dataSource.query(
      `UPDATE "journal_entries" SET "status" = 'validated', "validated_at" = $2, "validated_by_id" = $3 WHERE "id" = $1`,
      [opts.entryId, `${opts.entryDate}T00:00:00Z`, userId],
    );
  }

  const validityOf = (body: any) => body.data.validity;

  it('agrège un journal équilibré : compteur, imbalance 0, dernier mouvement', async () => {
    const alice = await seedUserAndLogin(app, 'alice-validity@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Validité');
    const periodId = 'd1111111-1111-1111-1111-111111111111';
    await seedPeriod(org.organizationId, periodId);
    await seedValidatedEntry(org.organizationId, alice.userId, {
      entryId: 'e1111111-1111-1111-1111-111111111111',
      periodId,
      entryNumber: 1,
      entryDate: '2026-03-10',
      lines: [
        { code: '411', debit: 5000, credit: 0 },
        { code: '4431', debit: 0, credit: 5000 },
      ],
    });
    await seedValidatedEntry(org.organizationId, alice.userId, {
      entryId: 'e2222222-2222-2222-2222-222222222222',
      periodId,
      entryNumber: 2,
      entryDate: '2026-05-20',
      lines: [
        { code: '411', debit: 1200, credit: 0 },
        { code: '4431', debit: 0, credit: 1200 },
      ],
    });

    const res = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/reports/validity?fromDate=2026-01-01&toDate=2026-12-31`,
      org.scopedAccessToken,
    );

    expect(res.status).toBe(HttpStatus.OK);
    const v = validityOf(res.body);
    expect(v.committedEntries).toBe(2);
    expect(v.imbalance).toBe(0);
    expect(v.lastMovementDate).toBe('2026-05-20');
    expect(v.periodClosed).toBe(false);
    expect(typeof v.computedAt).toBe('string');
  });

  it('période sans écriture : compteur 0, dernier mouvement null', async () => {
    const alice = await seedUserAndLogin(app, 'alice-empty@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Vide');

    const res = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/reports/validity?fromDate=2026-01-01&toDate=2026-12-31`,
      org.scopedAccessToken,
    );

    expect(res.status).toBe(HttpStatus.OK);
    const v = validityOf(res.body);
    expect(v.committedEntries).toBe(0);
    expect(v.imbalance).toBe(0);
    expect(v.lastMovementDate).toBeNull();
  });

  it('journal corrompu (lignes déséquilibrées forcées validées) : imbalance = écart', async () => {
    const alice = await seedUserAndLogin(app, 'alice-corrupt@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Corrompu');
    const periodId = 'd3333333-3333-3333-3333-333333333333';
    await seedPeriod(org.organizationId, periodId);
    await seedValidatedEntry(org.organizationId, alice.userId, {
      entryId: 'e3333333-3333-3333-3333-333333333333',
      periodId,
      entryNumber: 1,
      entryDate: '2026-04-01',
      lines: [
        { code: '411', debit: 5000, credit: 0 },
        { code: '4431', debit: 0, credit: 4000 },
      ],
    });

    const res = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/reports/validity?fromDate=2026-01-01&toDate=2026-12-31`,
      org.scopedAccessToken,
    );

    expect(res.status).toBe(HttpStatus.OK);
    const v = validityOf(res.body);
    expect(v.committedEntries).toBe(1);
    expect(v.imbalance).toBe(1000);
  });

  it('ignore les écritures hors de la fenêtre de dates', async () => {
    const alice = await seedUserAndLogin(app, 'alice-window@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Fenêtre');
    const periodId = 'd4444444-4444-4444-4444-444444444444';
    await seedPeriod(org.organizationId, periodId);
    await seedValidatedEntry(org.organizationId, alice.userId, {
      entryId: 'e4444444-4444-4444-4444-444444444444',
      periodId,
      entryNumber: 1,
      entryDate: '2026-05-15',
      lines: [
        { code: '411', debit: 800, credit: 0 },
        { code: '4431', debit: 0, credit: 800 },
      ],
    });

    const res = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/reports/validity?fromDate=2026-06-01&toDate=2026-12-31`,
      org.scopedAccessToken,
    );

    expect(res.status).toBe(HttpStatus.OK);
    expect(validityOf(res.body).committedEntries).toBe(0);
    expect(validityOf(res.body).lastMovementDate).toBeNull();
  });

  it('rejette une plage de dates invalide (fromDate > toDate)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-baddate@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Dates');

    const res = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/reports/validity?fromDate=2026-12-31&toDate=2026-01-01`,
      org.scopedAccessToken,
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error.code).toBe(ERROR_CODES.REPORT_INVALID_DATE_RANGE);
  });

  it('borne la lecture au dossier du jeton : l’URL ne peut pas cibler un autre tenant', async () => {
    const alice = await seedUserAndLogin(app, 'alice-tenant@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A');
    const periodId = 'd5555555-5555-5555-5555-555555555555';
    await seedPeriod(orgA.organizationId, periodId);
    await seedValidatedEntry(orgA.organizationId, alice.userId, {
      entryId: 'e5555555-5555-5555-5555-555555555555',
      periodId,
      entryNumber: 1,
      entryDate: '2026-02-02',
      lines: [
        { code: '411', debit: 300, credit: 0 },
        { code: '4431', debit: 0, credit: 300 },
      ],
    });
    const bob = await seedUserAndLogin(app, 'bob-tenant@e2e.test');
    const orgB = await createOrgAndSwitch(app, bob, 'Org B'); // 0 écriture

    // Alice (jeton orgA) vise l'URL d'orgB. Le TenantGuard lit l'org depuis le
    // JWT, jamais depuis l'URL : elle ne lit QUE orgA (1 écriture), jamais les
    // données d'orgB. L'URL `:id` est décorative et ne peut pas escalader.
    const res = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgB.organizationId}/reports/validity?fromDate=2026-01-01&toDate=2026-12-31`,
      orgA.scopedAccessToken,
    );

    expect(res.status).toBe(HttpStatus.OK);
    expect(validityOf(res.body).committedEntries).toBe(1);
  });
});
