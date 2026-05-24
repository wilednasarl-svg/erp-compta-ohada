import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { authedJson, createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

describe('e2e: TVA & Déclarations fiscales (Module 13)', () => {
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

  // ─────────────────────────────────────────────────────────────────
  // Codes TVA
  // ─────────────────────────────────────────────────────────────────

  it('seeds default TVA codes at organization creation time and supports CRUD (13.1)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-tva@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Konan');

    // 1. List seeded codes
    const listRes = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/tva/codes`,
      org.scopedAccessToken,
    );
    expect(listRes.status).toBe(HttpStatus.OK);
    const codes = listRes.body.data.codes;
    expect(codes.length).toBeGreaterThanOrEqual(4);
    
    const standardCode = codes.find((c: any) => c.code === 'TVA-N-18');
    expect(standardCode).toBeDefined();
    expect(Number(standardCode.rate)).toBe(18.00);
    expect(standardCode.type).toBe('both');

    // 2. Create custom TVA code
    const createRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/tva/codes`,
      org.scopedAccessToken,
    ).send({
      code: 'TVA-REDUIT-CI',
      label: 'TVA CI Réduit Spécial',
      rate: '5.50',
      type: 'sales',
      kind: 'reduced',
    });
    expect(createRes.status).toBe(HttpStatus.CREATED);
    const createdCode = createRes.body.data.code;
    expect(createdCode.code).toBe('TVA-REDUIT-CI');
    expect(Number(createdCode.rate)).toBe(5.50);

    // 3. Prevent duplicate TVA code
    const dupRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/tva/codes`,
      org.scopedAccessToken,
    ).send({
      code: 'TVA-REDUIT-CI',
      label: 'TVA CI Réduit Spécial',
      rate: '5.50',
      type: 'sales',
      kind: 'reduced',
    });
    expect(dupRes.status).toBe(HttpStatus.CONFLICT);
    expect(dupRes.body.error.code).toBe(ERROR_CODES.TVA_CODE_TAKEN);

    // 4. Update custom TVA code
    const updateRes = await authedJson(
      handle.http,
      'patch',
      `/organizations/${org.organizationId}/tva/codes/${createdCode.id}`,
      org.scopedAccessToken,
    ).send({
      label: 'TVA CI Réduit Spécial Renommé',
      rate: '6.00',
    });
    expect(updateRes.status).toBe(HttpStatus.OK);
    expect(updateRes.body.data.code.label).toBe('TVA CI Réduit Spécial Renommé');
    expect(Number(updateRes.body.data.code.rate)).toBe(6.00);
  });

  // ─────────────────────────────────────────────────────────────────
  // Déclarations TVA
  // ─────────────────────────────────────────────────────────────────

  it('handles TVA compute, list, getOne, and cancel lifecycle (13.2)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-decl@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Konan');

    // 1. Post a validated entry to seed collected/deductible VAT in a period
    // Find the OD journal ID for the organization
    const journal = (await dataSource.query(
      `SELECT "id" FROM "journals" WHERE "organization_id" = $1 AND "code" = 'OD' LIMIT 1`,
      [org.organizationId],
    ))[0];
    expect(journal).toBeDefined();

    // Insert an accounting period for 2026
    const periodId = 'd1111111-1111-1111-1111-111111111111';
    await dataSource.query(
      `INSERT INTO "accounting_periods" (
        "id", "organization_id", "parent_id", "kind", "label", "start_date", "end_date", "status"
      ) VALUES ($1, $2, null, 'ANNUAL', 'Exercice 2026', '2026-01-01', '2026-12-31', 'open')`,
      [periodId, org.organizationId],
    );

    // Insert a draft journal entry (so we don't trigger unbalanced validation check during line inserts)
    const entryId = 'e1111111-1111-1111-1111-111111111111';
    await dataSource.query(
      `INSERT INTO "journal_entries" (
        "id", "organization_id", "journal_id", "period_id", "entry_number",
        "description", "entry_date", "status", "created_by_id", "validated_at", "validated_by_id"
      ) VALUES ($1, $2, $3, $4, 1, 'Ecriture de test', '2026-05-15', 'draft', $5, null, null)`,
      [entryId, org.organizationId, journal.id, periodId, alice.userId],
    );

    // Collected VAT line (compte 4431*) -> Credit of 18000 (TVA)
    await dataSource.query(
      `INSERT INTO "journal_entry_lines" (
        "id", "organization_id", "journal_entry_id", "account_id", "position", "debit", "credit", "description"
      ) VALUES (
        'c1111111-1111-1111-1111-111111111111', $1, $2,
        (SELECT "id" FROM "organization_chart_accounts" WHERE "organization_id" = $1 AND "code" = '4431' LIMIT 1),
        1, 0.00, 18000.00, 'TVA Collectée'
      )`,
      [org.organizationId, entryId],
    );

    // Deductible VAT line BS (compte 4452*) -> Debit of 10000
    await dataSource.query(
      `INSERT INTO "journal_entry_lines" (
        "id", "organization_id", "journal_entry_id", "account_id", "position", "debit", "credit", "description"
      ) VALUES (
        'c2222222-2222-2222-2222-222222222222', $1, $2,
        (SELECT "id" FROM "organization_chart_accounts" WHERE "organization_id" = $1 AND "code" = '4452' LIMIT 1),
        2, 10000.00, 0.00, 'TVA Déductible B&S'
      )`,
      [org.organizationId, entryId],
    );

    // Deductible VAT line Immo (compte 4451*) -> Debit of 3000
    await dataSource.query(
      `INSERT INTO "journal_entry_lines" (
        "id", "organization_id", "journal_entry_id", "account_id", "position", "debit", "credit", "description"
      ) VALUES (
        'c3333333-3333-3333-3333-333333333333', $1, $2,
        (SELECT "id" FROM "organization_chart_accounts" WHERE "organization_id" = $1 AND "code" = '4451' LIMIT 1),
        3, 3000.00, 0.00, 'TVA Déductible Immo'
      )`,
      [org.organizationId, entryId],
    );

    // Balancing line to complete double entry (e.g. Clients 411) -> Debit of 5000
    await dataSource.query(
      `INSERT INTO "journal_entry_lines" (
        "id", "organization_id", "journal_entry_id", "account_id", "position", "debit", "credit", "description"
      ) VALUES (
        'c4444444-4444-4444-4444-444444444444', $1, $2,
        (SELECT "id" FROM "organization_chart_accounts" WHERE "organization_id" = $1 AND "code" = '411' LIMIT 1),
        4, 5000.00, 0.00, 'Clients'
      )`,
      [org.organizationId, entryId],
    );

    // Now update status to 'validated' (this triggers the balanced check, which succeeds because it is perfectly balanced!)
    await dataSource.query(
      `UPDATE "journal_entries"
       SET "status" = 'validated', "validated_at" = '2026-05-15T00:00:00Z', "validated_by_id" = $1
       WHERE "id" = $2`,
      [alice.userId, entryId],
    );

    // 2. Compute TVA declaration
    const computeRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/tva/declarations`,
      org.scopedAccessToken,
    ).send({
      year: 2026,
      month: 5,
    });
    expect(computeRes.status).toBe(HttpStatus.CREATED);
    const decl = computeRes.body.data.declaration;
    expect(decl.periodYear).toBe(2026);
    expect(decl.periodMonth).toBe(5);
    expect(decl.status).toBe('calculated');
    expect(Number(decl.tvaCollecteeTotal)).toBe(18000);
    expect(Number(decl.tvaDeductibleBsTotal)).toBe(10000);
    expect(Number(decl.tvaDeductibleImmoTotal)).toBe(3000);
    expect(Number(decl.tvaADecaisser)).toBe(5000); // 18000 - 10000 - 3000 = 5000
    expect(Number(decl.creditTvaReportable)).toBe(0);

    // 3. Compute again should throw 409 already exists
    const dupCompute = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/tva/declarations`,
      org.scopedAccessToken,
    ).send({
      year: 2026,
      month: 5,
    });
    expect(dupCompute.status).toBe(HttpStatus.CONFLICT);
    expect(dupCompute.body.error.code).toBe(ERROR_CODES.TVA_DECLARATION_ALREADY_EXISTS);

    // 4. List declarations
    const listRes = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/tva/declarations`,
      org.scopedAccessToken,
    );
    expect(listRes.status).toBe(HttpStatus.OK);
    expect(listRes.body.data.declarations.length).toBe(1);
    expect(listRes.body.data.declarations[0].id).toBe(decl.id);

    // 5. Get single declaration
    const getRes = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/tva/declarations/${decl.id}`,
      org.scopedAccessToken,
    );
    expect(getRes.status).toBe(HttpStatus.OK);
    expect(getRes.body.data.declaration.id).toBe(decl.id);

    // 6. Cancel declaration
    const cancelRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/tva/declarations/${decl.id}/cancel`,
      org.scopedAccessToken,
    ).send({
      reason: 'Correction d\'écriture',
    });
    expect(cancelRes.status).toBe(HttpStatus.OK);
    expect(cancelRes.body.data.declaration.status).toBe('cancelled');
    expect(cancelRes.body.data.declaration.cancelledReason).toBe('Correction d\'écriture');
  });

  // ─────────────────────────────────────────────────────────────────
  // Isolation de locataire (Tenant isolation)
  // ─────────────────────────────────────────────────────────────────

  it('enforces tenant isolation strictly for TVA codes and declarations (13.3)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-iso@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A');

    const bob = await seedUserAndLogin(app, 'bob-iso@e2e.test');
    const orgB = await createOrgAndSwitch(app, bob, 'Org B');

    // 1. Bob creates a TVA code in Org B
    const createRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgB.organizationId}/tva/codes`,
      orgB.scopedAccessToken,
    ).send({
      code: 'TVA-BOB',
      label: 'TVA Bob',
      rate: '10.00',
      type: 'both',
      kind: 'normal',
    });
    expect(createRes.status).toBe(HttpStatus.CREATED);
    const bobCodeId = createRes.body.data.code.id;

    // 2. Alice tries to read Bob's TVA code or list Org B codes -> 404 ORG_NOT_FOUND
    const aliceReadRes = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgB.organizationId}/tva/codes`,
      orgA.scopedAccessToken,
    );
    expect(aliceReadRes.status).toBe(HttpStatus.NOT_FOUND);
    expect(aliceReadRes.body.error.code).toBe(ERROR_CODES.ORG_NOT_FOUND);

    // 3. Alice tries to update Bob's TVA code -> 404 ORG_NOT_FOUND
    const aliceUpdateRes = await authedJson(
      handle.http,
      'patch',
      `/organizations/${orgB.organizationId}/tva/codes/${bobCodeId}`,
      orgA.scopedAccessToken,
    ).send({
      label: 'Alice Hack',
    });
    expect(aliceUpdateRes.status).toBe(HttpStatus.NOT_FOUND);
    expect(aliceUpdateRes.body.error.code).toBe(ERROR_CODES.ORG_NOT_FOUND);
  });
});
