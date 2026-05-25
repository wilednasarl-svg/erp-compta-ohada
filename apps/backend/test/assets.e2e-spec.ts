import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { authedJson, createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Module 12 — Immobilisations & Amortissements.
 *
 * The asset DTO accepts UUIDs (not codes) for the three chart-of-account
 * references. The org is created with the NORMAL system, which clones the
 * full SYSCOHADA reference chart, so we resolve the three required
 * account UUIDs by joining on `code` before each test phase.
 *
 * Codes used:
 *   - 24    → matériel informatique (compte brut)
 *   - 284   → amortissements du matériel (cumul, sens crédit)
 *   - 6811  → dotation aux amortissements (charge, sens débit)
 */
async function resolveAccountIds(
  dataSource: DataSource,
  organizationId: string,
  codes: ReadonlyArray<string>,
): Promise<Record<string, string>> {
  const rows = await dataSource.query<Array<{ id: string; code: string }>>(
    `SELECT id, code FROM organization_chart_accounts
     WHERE organization_id = $1 AND code = ANY($2::text[])`,
    [organizationId, codes],
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.code] = r.id;
  for (const c of codes) {
    if (!map[c]) {
      throw new Error(
        `Account code '${c}' not found in chart of accounts for org ${organizationId}`,
      );
    }
  }
  return map;
}

describe('e2e: Immobilisations & Amortissements (Module 12)', () => {
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

  it('handles asset lifecycle: creation, schedule, update, posting, disposal (12.1)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-assets@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Konan');

    const accounts = await resolveAccountIds(dataSource, org.organizationId, [
      '24',
      '284',
      '6811',
    ]);

    // ─── 1. Create asset (linear, 5 years) ──────────────────────────────
    const createRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/assets`,
      org.scopedAccessToken,
    ).send({
      code: 'IMMO-001',
      label: 'Serveur HP ProLiant',
      acquisitionDate: '2026-01-01',
      putInServiceDate: '2026-01-01',
      acquisitionCost: '12000000.00',
      depreciationMethod: 'linear',
      durationMonths: 60,
      assetAccountId: accounts['24'],
      depreciationAccountId: accounts['284'],
      expenseAccountId: accounts['6811'],
    });

    expect(createRes.status).toBe(HttpStatus.CREATED);
    const asset = createRes.body.data.asset;
    expect(asset.code).toBe('IMMO-001');
    expect(asset.status).toBe('active');
    expect(Number(asset.acquisitionCost)).toBe(12000000);
    expect(createRes.body.data.schedule.length).toBeGreaterThan(0);

    // ─── 2. Verify schedule sums to acquisitionCost ─────────────────────
    const getScheduleRes = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/assets/${asset.id}/schedule`,
      org.scopedAccessToken,
    );
    expect(getScheduleRes.status).toBe(HttpStatus.OK);
    const schedule = getScheduleRes.body.data.schedule;
    expect(schedule.length).toBeGreaterThan(0);
    const totalDepreciated = schedule.reduce(
      (s: number, l: { depreciationAmount: string }) => s + Number(l.depreciationAmount),
      0,
    );
    expect(totalDepreciated).toBeCloseTo(12000000, 2);

    // ─── 3. Duplicate code is rejected ──────────────────────────────────
    const dupRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/assets`,
      org.scopedAccessToken,
    ).send({
      code: 'IMMO-001',
      label: 'Autre serveur',
      acquisitionDate: '2026-01-01',
      putInServiceDate: '2026-01-01',
      acquisitionCost: '5000000.00',
      depreciationMethod: 'linear',
      durationMonths: 36,
      assetAccountId: accounts['24'],
      depreciationAccountId: accounts['284'],
      expenseAccountId: accounts['6811'],
    });
    expect(dupRes.status).toBe(HttpStatus.CONFLICT);
    expect(dupRes.body.error.code).toBe(ERROR_CODES.ASSET_CODE_TAKEN);

    // ─── 4a. Non-financial update (label) preserves schedule ids ────────
    const origFirstLineId = schedule[0].id;
    const updateLabelRes = await authedJson(
      handle.http,
      'patch',
      `/organizations/${org.organizationId}/assets/${asset.id}`,
      org.scopedAccessToken,
    ).send({ label: 'Serveur HP ProLiant Gen10 Plus' });
    expect(updateLabelRes.status).toBe(HttpStatus.OK);
    expect(updateLabelRes.body.data.asset.label).toBe('Serveur HP ProLiant Gen10 Plus');

    const getScheduleRes2 = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/assets/${asset.id}/schedule`,
      org.scopedAccessToken,
    );
    expect(getScheduleRes2.body.data.schedule[0].id).toBe(origFirstLineId);

    // ─── 4b. Financial update (durationMonths) regenerates schedule ─────
    const updateDurationRes = await authedJson(
      handle.http,
      'patch',
      `/organizations/${org.organizationId}/assets/${asset.id}`,
      org.scopedAccessToken,
    ).send({ durationMonths: 48 });
    expect(updateDurationRes.status).toBe(HttpStatus.OK);
    expect(updateDurationRes.body.data.asset.durationMonths).toBe(48);

    const getScheduleRes3 = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/assets/${asset.id}/schedule`,
      org.scopedAccessToken,
    );
    const newSchedule = getScheduleRes3.body.data.schedule;
    expect(newSchedule[0].id).not.toBe(origFirstLineId);
    const totalDepreciated48 = newSchedule.reduce(
      (s: number, l: { depreciationAmount: string }) => s + Number(l.depreciationAmount),
      0,
    );
    expect(totalDepreciated48).toBeCloseTo(12000000, 2);

    // ─── 5. Post first schedule line as a journal entry ─────────────────
    // The OD journal is seeded by `seedStandardJournals` at org creation,
    // but the 2026 accounting period needs to be created so the entry's
    // entryDate (period_end of the schedule line) lands in an open period.
    await dataSource.query(
      `INSERT INTO "accounting_periods" (
        "organization_id", "kind", "label",
        "start_date", "end_date", "status"
      ) VALUES ($1, 'ANNUAL', 'Exercice 2026', '2026-01-01', '2026-12-31', 'open')`,
      [org.organizationId],
    );

    const firstScheduleLine = newSchedule[0];
    const postRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/assets/schedules/${firstScheduleLine.id}/post`,
      org.scopedAccessToken,
    );
    expect(postRes.status).toBe(HttpStatus.OK);
    const postedLine = postRes.body.data.schedule;
    expect(postedLine.status).toBe('posted');
    expect(postedLine.journalEntryId).not.toBeNull();

    // ─── 5b. Double-post is rejected ────────────────────────────────────
    const postDupRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/assets/schedules/${firstScheduleLine.id}/post`,
      org.scopedAccessToken,
    );
    expect(postDupRes.status).toBe(HttpStatus.CONFLICT);
    expect(postDupRes.body.error.code).toBe(
      ERROR_CODES.DEPRECIATION_SCHEDULE_ALREADY_POSTED,
    );

    // ─── 6. Dispose the asset ───────────────────────────────────────────
    const disposeRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${org.organizationId}/assets/${asset.id}/dispose`,
      org.scopedAccessToken,
    ).send({ disposalDate: '2026-06-30', disposalValue: '8000000.00' });
    expect(disposeRes.status).toBe(HttpStatus.OK);
    expect(disposeRes.body.data.asset.status).toBe('disposed');
    expect(disposeRes.body.data.asset.disposalDate).toBe('2026-06-30');
    expect(Number(disposeRes.body.data.asset.disposalValue)).toBe(8000000);

    // Only the posted line should remain — pending lines are purged on dispose.
    const finalScheduleRes = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/assets/${asset.id}/schedule`,
      org.scopedAccessToken,
    );
    const finalSchedule = finalScheduleRes.body.data.schedule;
    expect(finalSchedule.length).toBe(1);
    expect(finalSchedule[0].id).toBe(firstScheduleLine.id);
    expect(finalSchedule[0].status).toBe('posted');
  });

  it('enforces tenant isolation strictly for Assets (12.2)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-iso@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A');

    const bob = await seedUserAndLogin(app, 'bob-iso@e2e.test');
    const orgB = await createOrgAndSwitch(app, bob, 'Org B');

    const orgBAccounts = await resolveAccountIds(dataSource, orgB.organizationId, [
      '24',
      '284',
      '6811',
    ]);

    // Bob creates an asset in Org B.
    const createRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgB.organizationId}/assets`,
      orgB.scopedAccessToken,
    ).send({
      code: 'IMMO-BOB',
      label: 'Serveur Bob',
      acquisitionDate: '2026-01-01',
      putInServiceDate: '2026-01-01',
      acquisitionCost: '5000000.00',
      depreciationMethod: 'linear',
      durationMonths: 36,
      assetAccountId: orgBAccounts['24'],
      depreciationAccountId: orgBAccounts['284'],
      expenseAccountId: orgBAccounts['6811'],
    });
    expect(createRes.status).toBe(HttpStatus.CREATED);
    const bobAssetId = createRes.body.data.asset.id;

    // Alice reads Bob's asset via Org B URL with Alice's token → 404.
    const aliceReadRes = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgB.organizationId}/assets/${bobAssetId}`,
      orgA.scopedAccessToken,
    );
    expect(aliceReadRes.status).toBe(HttpStatus.NOT_FOUND);
    expect(aliceReadRes.body.error.code).toBe(ERROR_CODES.ORG_NOT_FOUND);

    // Alice patches Bob's asset → 404.
    const aliceUpdateRes = await authedJson(
      handle.http,
      'patch',
      `/organizations/${orgB.organizationId}/assets/${bobAssetId}`,
      orgA.scopedAccessToken,
    ).send({ label: 'Alice Hack' });
    expect(aliceUpdateRes.status).toBe(HttpStatus.NOT_FOUND);
    expect(aliceUpdateRes.body.error.code).toBe(ERROR_CODES.ORG_NOT_FOUND);
  });
});
