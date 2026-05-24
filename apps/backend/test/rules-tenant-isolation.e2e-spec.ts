import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { authedJson, createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Section 13.2 — Module 5 Rules Engine tenant isolation.
 *
 * Org A ne peut pas lire, modifier, simuler ni appliquer les règles d'org B.
 * TenantGuard renvoie toujours ORG_NOT_FOUND (404) — jamais 403 — pour ne
 * pas divulguer l'existence de l'org cible.
 *
 * Requires `TEST_DATABASE_URL` (see `test/setup/load-env.ts`).
 */
describe('e2e: rules tenant isolation (13.2)', () => {
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

  it('cross-tenant GET rule returns 404, never the row (13.2)', async () => {
    const alice = await seedUserAndLogin(app, 'rules-iso-alice@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A Rules');

    const bob = await seedUserAndLogin(app, 'rules-iso-bob@e2e.test');
    const orgB = await createOrgAndSwitch(app, bob, 'Org B Rules');

    // Bob crée une règle dans org B.
    const created = await authedJson(
      handle.http, 'post', `/organizations/${orgB.organizationId}/rules`, orgB.scopedAccessToken,
    ).send({
      name: 'Bob rule private',
      isActive: true,
      priority: 10,
      conditions: [{ type: 'account_prefix', prefix: '60' }],
      actions: [{ type: 'add_tag', tag: 'SECRET' }],
    });
    expect(created.status).toBe(HttpStatus.CREATED);
    const ruleId = (created.body.data ?? created.body).id as string;

    // Alice (token org A) tente de lire la règle via l'URL d'org B.
    const crossRead = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgB.organizationId}/rules/${ruleId}`,
      orgA.scopedAccessToken,
    );
    expect(crossRead.status).toBe(HttpStatus.NOT_FOUND);
    expect(crossRead.body.error.code).toBe(ERROR_CODES.ORG_NOT_FOUND);

    // Bob dans son propre org voit la règle.
    const ok = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgB.organizationId}/rules/${ruleId}`,
      orgB.scopedAccessToken,
    );
    expect(ok.status).toBe(HttpStatus.OK);
  });

  it('cross-tenant list returns 404 (13.2)', async () => {
    const alice = await seedUserAndLogin(app, 'rules-iso-list-alice@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A list');

    const bob = await seedUserAndLogin(app, 'rules-iso-list-bob@e2e.test');
    const orgB = await createOrgAndSwitch(app, bob, 'Org B list');

    // Alice essaie de lister les règles d'org B.
    const crossList = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgB.organizationId}/rules`,
      orgA.scopedAccessToken,
    );
    expect(crossList.status).toBe(HttpStatus.NOT_FOUND);
    expect(crossList.body.error.code).toBe(ERROR_CODES.ORG_NOT_FOUND);
  });

  it('cross-tenant simulate returns 404 (13.2)', async () => {
    const alice = await seedUserAndLogin(app, 'rules-iso-sim-alice@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A sim');

    const bob = await seedUserAndLogin(app, 'rules-iso-sim-bob@e2e.test');
    const orgB = await createOrgAndSwitch(app, bob, 'Org B sim');

    // Bob crée une règle.
    const r = await authedJson(
      handle.http, 'post', `/organizations/${orgB.organizationId}/rules`, orgB.scopedAccessToken,
    ).send({
      name: 'Bob sim rule',
      isActive: true,
      priority: 5,
      conditions: [{ type: 'account_prefix', prefix: '70' }],
      actions: [{ type: 'add_tag', tag: 'TAG' }],
    });
    const ruleId = (r.body.data ?? r.body).id as string;

    // Alice tente simulate sur la règle de Bob.
    const crossSim = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgB.organizationId}/rules/${ruleId}/simulate`,
      orgA.scopedAccessToken,
    ).send({});
    expect(crossSim.status).toBe(HttpStatus.NOT_FOUND);
    expect(crossSim.body.error.code).toBe(ERROR_CODES.ORG_NOT_FOUND);
  });

  it('cross-tenant apply returns 404 (13.2)', async () => {
    const alice = await seedUserAndLogin(app, 'rules-iso-apply-alice@e2e.test');
    const orgA = await createOrgAndSwitch(app, alice, 'Org A apply');

    const bob = await seedUserAndLogin(app, 'rules-iso-apply-bob@e2e.test');
    const orgB = await createOrgAndSwitch(app, bob, 'Org B apply');

    const r = await authedJson(
      handle.http, 'post', `/organizations/${orgB.organizationId}/rules`, orgB.scopedAccessToken,
    ).send({
      name: 'Bob apply rule',
      isActive: true,
      priority: 5,
      conditions: [{ type: 'account_prefix', prefix: '70' }],
      actions: [{ type: 'add_tag', tag: 'TAG' }],
    });
    const ruleId = (r.body.data ?? r.body).id as string;

    const crossApply = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgB.organizationId}/rules/${ruleId}/apply`,
      orgA.scopedAccessToken,
    ).send({});
    expect(crossApply.status).toBe(HttpStatus.NOT_FOUND);
    expect(crossApply.body.error.code).toBe(ERROR_CODES.ORG_NOT_FOUND);
  });
});
