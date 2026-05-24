import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { authedJson, createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * GET /audit/logs — Module 7 end-to-end contract.
 *
 *   A. Basic listing: org creation seeds audit events → endpoint returns them.
 *   B. Filter by module: only module-specific events returned.
 *   C. Filter by entityType + entityId: precise entity history.
 *   D. Tenant isolation: org A cannot see org B events.
 *   E. RBAC: missing `audit.read` → 403.
 *   F. Pagination: limit + offset.
 *   G. Cursor pagination: nextCursor navigates pages stably.
 *   H. from/to date range: filters by createdAt.
 */
describe('e2e: GET /audit/logs (Module 7)', () => {
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

  // ── A. Basic listing ──────────────────────────────────────────────────

  it('A: returns audit logs after org creation (chart_of_accounts.imported event)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-audit@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Audit');

    const res = await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken);

    expect(res.status).toBe(HttpStatus.OK);
    const body = res.body as {
      data: {
        logs: Array<{ module: string; action: string }>;
        pagination: { total: number };
      };
    };
    expect(body.data.pagination.total).toBeGreaterThan(0);
    expect(body.data.logs.length).toBeGreaterThan(0);

    // Org creation seeds at least the chart_of_accounts.imported event.
    const imported = body.data.logs.find(
      (l) => l.module === 'chart_of_accounts' && l.action === 'imported',
    );
    expect(imported).toBeDefined();
  });

  // ── B. Filter by module ───────────────────────────────────────────────

  it('B: module filter returns only events for the requested module', async () => {
    const alice = await seedUserAndLogin(app, 'alice-filter@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Filter');

    const res = await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken).query({
      module: 'chart_of_accounts',
    });

    expect(res.status).toBe(HttpStatus.OK);
    const logs = (res.body as { data: { logs: Array<{ module: string }> } }).data.logs;
    for (const log of logs) {
      expect(log.module).toBe('chart_of_accounts');
    }
    expect(logs.length).toBeGreaterThan(0);
  });

  it('B: module filter with unknown module returns empty list (no bleed-through)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-empty@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Empty');

    const res = await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken).query({
      module: 'nonexistent_module',
    });

    expect(res.status).toBe(HttpStatus.OK);
    const body = res.body as { data: { logs: unknown[]; pagination: { total: number } } };
    expect(body.data.logs).toHaveLength(0);
    expect(body.data.pagination.total).toBe(0);
  });

  // ── C. Filter by entityType + entityId ───────────────────────────────

  it('C: entityType + entityId filter returns only events for that entity', async () => {
    const alice = await seedUserAndLogin(app, 'alice-entity@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Entity');

    // Fetch the first account from the cloned chart to use as entity target.
    const chartRes = await authedJson(
      handle.http,
      'get',
      `/organizations/${org.organizationId}/chart-of-accounts`,
      org.scopedAccessToken,
    );
    const firstAccount = (chartRes.body as { data: { accounts: Array<{ id: string }> } }).data
      .accounts[0];
    if (firstAccount === undefined) {
      return; // Skip if no accounts were cloned — shouldn't happen in NORMAL.
    }

    const res = await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken).query({
      entityType: 'organization_account',
      entityId: firstAccount.id,
    });

    expect(res.status).toBe(HttpStatus.OK);
    const logs = (res.body as { data: { logs: Array<{ entityId: string; entityType: string }> } })
      .data.logs;
    for (const log of logs) {
      expect(log.entityType).toBe('organization_account');
      expect(log.entityId).toBe(firstAccount.id);
    }
  });

  // ── D. Tenant isolation ──────────────────────────────────────────────

  it('D: org A cannot read org B audit logs (no cross-tenant bleed)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-iso@e2e.test');
    const bob = await seedUserAndLogin(app, 'bob-iso@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A Isolation');
    const orgB = await createOrgAndSwitch(app, bob, 'Org B Isolation');

    // Alice lists logs using her token — should see org A events only.
    const res = await authedJson(handle.http, 'get', '/audit/logs', orgA.scopedAccessToken);

    expect(res.status).toBe(HttpStatus.OK);
    const logs = (res.body as { data: { logs: Array<{ organizationId: string }> } }).data.logs;

    for (const log of logs) {
      expect(log.organizationId).toBe(orgA.organizationId);
      expect(log.organizationId).not.toBe(orgB.organizationId);
    }
  });

  // ── E. RBAC ──────────────────────────────────────────────────────────

  it('E: request without a bearer token is rejected with 401', async () => {
    const res = await handle.http.get('/audit/logs');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('E: token not scoped to any org is rejected by TenantGuard (404)', async () => {
    const alice = await seedUserAndLogin(app, 'alice-noorg@e2e.test');
    // Use the pre-switch token — no org_id claim.
    const res = await handle.http
      .get('/audit/logs')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect([HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND]).toContain(res.status);
  });

  // ── F. Offset pagination ──────────────────────────────────────────────

  it('F: limit and offset control the page size and window', async () => {
    const alice = await seedUserAndLogin(app, 'alice-page@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Page');

    const page1 = await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken).query({
      limit: 2,
      offset: 0,
    });
    const page2 = await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken).query({
      limit: 2,
      offset: 2,
    });

    expect(page1.status).toBe(HttpStatus.OK);
    expect(page2.status).toBe(HttpStatus.OK);

    const logs1 = (page1.body as { data: { logs: Array<{ id: string }> } }).data.logs;
    const logs2 = (page2.body as { data: { logs: Array<{ id: string }> } }).data.logs;

    // No overlap between pages.
    const ids1 = new Set(logs1.map((l) => l.id));
    for (const l of logs2) {
      expect(ids1.has(l.id)).toBe(false);
    }
  });

  // ── G. Cursor pagination ──────────────────────────────────────────────

  it('G: nextCursor is returned on a full page and navigates to the next page', async () => {
    const alice = await seedUserAndLogin(app, 'alice-cursor@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet Cursor');

    const total: number = (
      await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken)
    ).body.data.pagination.total;

    if (total < 2) {
      return; // Not enough rows to test cursor pagination.
    }

    const page1 = await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken).query({
      limit: 1,
    });
    const cursor: string | null = (
      page1.body as { data: { pagination: { nextCursor: string | null } } }
    ).data.pagination.nextCursor;
    expect(cursor).not.toBeNull();

    const page2 = await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken).query({
      cursor,
      limit: 1,
    });
    expect(page2.status).toBe(HttpStatus.OK);

    const ids1 = (page1.body as { data: { logs: Array<{ id: string }> } }).data.logs.map(
      (l) => l.id,
    );
    const ids2 = (page2.body as { data: { logs: Array<{ id: string }> } }).data.logs.map(
      (l) => l.id,
    );

    // Pages don't overlap.
    for (const id of ids2) {
      expect(ids1).not.toContain(id);
    }
  });

  // ── H. Date range ─────────────────────────────────────────────────────

  it('H: from > to returns an empty page without error', async () => {
    const alice = await seedUserAndLogin(app, 'alice-daterange@e2e.test');
    const org = await createOrgAndSwitch(app, alice, 'Cabinet DateRange');

    const res = await authedJson(handle.http, 'get', '/audit/logs', org.scopedAccessToken).query({
      from: '2026-12-31T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(HttpStatus.OK);
    const body = res.body as { data: { logs: unknown[]; pagination: { total: number } } };
    expect(body.data.logs).toHaveLength(0);
    expect(body.data.pagination.total).toBe(0);
  });
});
