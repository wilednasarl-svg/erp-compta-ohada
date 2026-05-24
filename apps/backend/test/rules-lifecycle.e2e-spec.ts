import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { authedJson, createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Section 13.1 — Module 5 Rules Engine lifecycle e2e.
 *
 *   create rule → simulate on import session scope → apply → get executions
 *
 * Requires `TEST_DATABASE_URL` (see `test/setup/load-env.ts`).
 */
describe('e2e: rules lifecycle (13.1)', () => {
  let handle: E2eAppHandle;
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    jest.setTimeout(120000);
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

  it('create → simulate → apply → execution history (13.1)', async () => {
    const admin = await seedUserAndLogin(app, 'rules-life-admin@e2e.test');
    const org = await createOrgAndSwitch(app, admin, 'Cabinet Rules Lifecycle');
    const orgId = org.organizationId;
    const token = org.scopedAccessToken;

    // ── 1. Seed an import session + staging entries via the imports API ─────

    const sessionRes = await authedJson(handle.http, 'post', `/organizations/${orgId}/imports/sessions`, token)
      .send({ sourceType: 'csv', label: 'Test rules' });
    expect(sessionRes.status).toBe(HttpStatus.CREATED);
    const sessionId = sessionRes.body.data.session.id as string;

    // CSV with account '401000' — will match condition account_prefix='40'.
    const csv = 'compte,libelle,debit,credit\n401000,Fournisseur XYZ,0,5000\n';
    const upload = await handle.http
      .post(`/organizations/${orgId}/imports/sessions/${sessionId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'achats.csv');
    expect(upload.status).toBe(HttpStatus.CREATED);

    // ── 2. Create a rule ────────────────────────────────────────────────────

    const created = await authedJson(handle.http, 'post', `/organizations/${orgId}/rules`, token).send({
      name: 'Reclasser comptes 40x',
      isActive: true,
      priority: 100,
      conditions: [{ type: 'account_prefix', prefix: '40' }],
      actions: [{ type: 'reclassify_account', targetAccount: '401100' }],
    });
    expect(created.status).toBe(HttpStatus.CREATED);
    const rule = created.body.data ?? created.body;
    const ruleId = rule.id as string;
    expect(ruleId).toBeDefined();

    // GET: liste des règles contient la nouvelle règle.
    const list = await authedJson(handle.http, 'get', `/organizations/${orgId}/rules`, token);
    expect(list.status).toBe(HttpStatus.OK);
    const rules: Array<{ id: string }> = list.body.data ?? list.body;
    expect(rules.some((r) => r.id === ruleId)).toBe(true);

    // GET: détail.
    const detail = await authedJson(handle.http, 'get', `/organizations/${orgId}/rules/${ruleId}`, token);
    expect(detail.status).toBe(HttpStatus.OK);

    // ── 3. Simulate ─────────────────────────────────────────────────────────

    const simRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules/${ruleId}/simulate`,
      token,
    ).send({ importSessionId: sessionId });
    expect(simRes.status).toBe(HttpStatus.OK);
    const sim = simRes.body.data ?? simRes.body;
    expect(sim.mode).toBe('simulation');
    expect(sim.matchedCount).toBeGreaterThanOrEqual(1);
    expect(sim.appliedCount).toBe(0);
    // Simulate doit JAMAIS créer de transformations.
    expect(sim.matches[0].transformationIds).toBeNull();

    // ── 4. Apply ────────────────────────────────────────────────────────────

    const applyRes = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules/${ruleId}/apply`,
      token,
    ).send({ importSessionId: sessionId });
    expect(applyRes.status).toBe(HttpStatus.OK);
    const applied = applyRes.body.data ?? applyRes.body;
    expect(applied.mode).toBe('apply');
    expect(applied.matchedCount).toBeGreaterThanOrEqual(1);
    expect(applied.appliedCount).toBeGreaterThanOrEqual(1);
    // L'action reclassify_account doit avoir créé une transformation.
    const firstMatch = applied.matches[0];
    expect(Array.isArray(firstMatch.transformationIds)).toBe(true);
    expect(firstMatch.transformationIds.length).toBeGreaterThanOrEqual(1);

    // ── 5. Execution history ────────────────────────────────────────────────

    const histRes = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgId}/rules/${ruleId}/executions`,
      token,
    );
    expect(histRes.status).toBe(HttpStatus.OK);
    const execs: Array<{ mode: string }> = histRes.body.data ?? histRes.body;
    expect(execs.length).toBeGreaterThanOrEqual(2);
    const modes = execs.map((e) => e.mode);
    expect(modes).toContain('simulation');
    expect(modes).toContain('apply');
  });

  it('simulate on empty scope returns matchedCount=0 without error (13.1 edge)', async () => {
    const admin = await seedUserAndLogin(app, 'rules-empty-sim@e2e.test');
    const org = await createOrgAndSwitch(app, admin, 'Cabinet Empty Sim');
    const orgId = org.organizationId;
    const token = org.scopedAccessToken;

    const created = await authedJson(handle.http, 'post', `/organizations/${orgId}/rules`, token).send({
      name: 'Empty scope rule',
      isActive: true,
      priority: 50,
      conditions: [{ type: 'account_prefix', prefix: '99' }],
      actions: [{ type: 'add_tag', tag: 'UNUSED' }],
    });
    expect(created.status).toBe(HttpStatus.CREATED);
    const ruleId = (created.body.data ?? created.body).id as string;

    // Aucune écriture dans cette org → matchedCount=0.
    const sim = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules/${ruleId}/simulate`,
      token,
    ).send({});
    expect(sim.status).toBe(HttpStatus.OK);
    const result = sim.body.data ?? sim.body;
    expect(result.matchedCount).toBe(0);
    expect(result.appliedCount).toBe(0);
  });

  it('returns 404 when fetching an unknown rule (13.1 error path)', async () => {
    const admin = await seedUserAndLogin(app, 'rules-notfound@e2e.test');
    const org = await createOrgAndSwitch(app, admin, 'Cabinet NotFound');
    const orgId = org.organizationId;
    const fakeId = '00000000-0000-4000-8000-000000000099';

    const res = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgId}/rules/${fakeId}`,
      org.scopedAccessToken,
    );
    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    expect(res.body.error.code).toBe('RULE_NOT_FOUND');
  });
});
