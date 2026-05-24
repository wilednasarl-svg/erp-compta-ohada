import { type INestApplication, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ERROR_CODES } from '../src/common/errors/error-codes';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { authedJson, createOrgAndSwitch, seedUserAndLogin } from './helpers/auth';
import { resetTables } from './helpers/db';

/**
 * Section 13.3 — Module 5 Rules Engine RBAC.
 *
 * Matrice de permissions (spec 1.5) :
 *   admin / expert_comptable / chef_mission : read + write + simulate + apply
 *   comptable                               : read + simulate
 *   auditeur / client_readonly              : read seul
 *
 * Requires `TEST_DATABASE_URL` (see `test/setup/load-env.ts`).
 */
describe('e2e: rules RBAC (13.3)', () => {
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

  /**
   * Seed a second user as a given role, then return a token scoped to the org.
   */
  async function addMemberAndGetToken(
    orgId: string,
    email: string,
    roleCode: string,
  ): Promise<string> {
    const member = await seedUserAndLogin(app, email);
    await dataSource.query(
      `INSERT INTO "memberships" (user_id, organization_id, role_id, status)
       SELECT $1, $2, r.id, 'active' FROM roles r WHERE r.code = $3`,
      [member.userId, orgId, roleCode],
    );
    const select = await handle.http
      .post('/auth/select-organization')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ organizationId: orgId });
    expect(select.status).toBe(HttpStatus.OK);
    return select.body.data.accessToken as string;
  }

  it('auditeur: read OK, write 403, simulate 403, apply 403 (13.3)', async () => {
    const admin = await seedUserAndLogin(app, 'rbac-aud-admin@e2e.test');
    const org = await createOrgAndSwitch(app, admin, 'Org Auditeur RBAC');
    const orgId = org.organizationId;

    // Admin crée une règle de référence.
    const r = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules`,
      org.scopedAccessToken,
    ).send({
      name: 'Règle ref',
      isActive: true,
      priority: 10,
      conditions: [{ type: 'account_prefix', prefix: '60' }],
      actions: [{ type: 'add_tag', tag: 'X' }],
    });
    expect(r.status).toBe(HttpStatus.CREATED);
    const ruleId = (r.body.data ?? r.body).id as string;

    const auditorToken = await addMemberAndGetToken(orgId, 'rbac-auditor@e2e.test', 'auditeur');

    // read → 200.
    const list = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgId}/rules`,
      auditorToken,
    );
    expect(list.status).toBe(HttpStatus.OK);

    const detail = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgId}/rules/${ruleId}`,
      auditorToken,
    );
    expect(detail.status).toBe(HttpStatus.OK);

    // write → 403.
    const write = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules`,
      auditorToken,
    ).send({
      name: 'Hack rule',
      isActive: true,
      priority: 1,
      conditions: [{ type: 'account_prefix', prefix: '10' }],
      actions: [{ type: 'add_tag', tag: 'HACK' }],
    });
    expect(write.status).toBe(HttpStatus.FORBIDDEN);
    expect(write.body.error.code).toBe(ERROR_CODES.FORBIDDEN_PERMISSION);

    // simulate → 403.
    const sim = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules/${ruleId}/simulate`,
      auditorToken,
    ).send({});
    expect(sim.status).toBe(HttpStatus.FORBIDDEN);
    expect(sim.body.error.code).toBe(ERROR_CODES.FORBIDDEN_PERMISSION);

    // apply → 403.
    const apply = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules/${ruleId}/apply`,
      auditorToken,
    ).send({});
    expect(apply.status).toBe(HttpStatus.FORBIDDEN);
    expect(apply.body.error.code).toBe(ERROR_CODES.FORBIDDEN_PERMISSION);
  });

  it('comptable: read OK, simulate OK, write 403, apply 403 (13.3)', async () => {
    const admin = await seedUserAndLogin(app, 'rbac-cpt-admin@e2e.test');
    const org = await createOrgAndSwitch(app, admin, 'Org Comptable RBAC');
    const orgId = org.organizationId;

    const r = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules`,
      org.scopedAccessToken,
    ).send({
      name: 'Règle cpt',
      isActive: true,
      priority: 10,
      conditions: [{ type: 'account_prefix', prefix: '70' }],
      actions: [{ type: 'add_tag', tag: 'Y' }],
    });
    expect(r.status).toBe(HttpStatus.CREATED);
    const ruleId = (r.body.data ?? r.body).id as string;

    const comptableToken = await addMemberAndGetToken(
      orgId,
      'rbac-comptable@e2e.test',
      'comptable',
    );

    // read → 200.
    const list = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgId}/rules`,
      comptableToken,
    );
    expect(list.status).toBe(HttpStatus.OK);

    // simulate → 200 (matchedCount=0 — aucune écriture, mais le droit est là).
    const sim = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules/${ruleId}/simulate`,
      comptableToken,
    ).send({});
    expect(sim.status).toBe(HttpStatus.OK);
    const simBody = sim.body.data ?? sim.body;
    expect(simBody.mode).toBe('simulation');

    // write → 403.
    const write = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules`,
      comptableToken,
    ).send({
      name: 'Hack',
      isActive: true,
      priority: 1,
      conditions: [{ type: 'account_prefix', prefix: '10' }],
      actions: [{ type: 'add_tag', tag: 'H' }],
    });
    expect(write.status).toBe(HttpStatus.FORBIDDEN);
    expect(write.body.error.code).toBe(ERROR_CODES.FORBIDDEN_PERMISSION);

    // apply → 403.
    const apply = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules/${ruleId}/apply`,
      comptableToken,
    ).send({});
    expect(apply.status).toBe(HttpStatus.FORBIDDEN);
    expect(apply.body.error.code).toBe(ERROR_CODES.FORBIDDEN_PERMISSION);
  });

  it('expert_comptable: toutes les opérations autorisées (13.3)', async () => {
    const admin = await seedUserAndLogin(app, 'rbac-expert-admin@e2e.test');
    const org = await createOrgAndSwitch(app, admin, 'Org Expert RBAC');
    const orgId = org.organizationId;

    const expertToken = await addMemberAndGetToken(
      orgId,
      'rbac-expert@e2e.test',
      'expert_comptable',
    );

    // write → 201.
    const r = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules`,
      expertToken,
    ).send({
      name: 'Expert rule',
      isActive: true,
      priority: 20,
      conditions: [{ type: 'account_prefix', prefix: '60' }],
      actions: [{ type: 'add_tag', tag: 'EXP' }],
    });
    expect(r.status).toBe(HttpStatus.CREATED);
    const ruleId = (r.body.data ?? r.body).id as string;

    // read → 200.
    const detail = await authedJson(
      handle.http,
      'get',
      `/organizations/${orgId}/rules/${ruleId}`,
      expertToken,
    );
    expect(detail.status).toBe(HttpStatus.OK);

    // simulate → 200.
    const sim = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules/${ruleId}/simulate`,
      expertToken,
    ).send({});
    expect(sim.status).toBe(HttpStatus.OK);

    // apply → 200.
    const apply = await authedJson(
      handle.http,
      'post',
      `/organizations/${orgId}/rules/${ruleId}/apply`,
      expertToken,
    ).send({});
    expect(apply.status).toBe(HttpStatus.OK);
  });
});
