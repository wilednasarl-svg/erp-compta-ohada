# Integration tests (Section 10)

End-to-end suite that boots the real NestJS app against a real Postgres
and exercises HTTP routes via supertest. Catches wiring bugs that unit
tests can't see: guard composition, validation pipe, response envelope,
exception filter mapping, real SQL execution against the migrated schema.

## Provisioning a test database

Pick the option that matches your environment. The e2e harness is
DSN-agnostic — anything Postgres ≥ 14 that supports `pgcrypto`,
`citext`, `inet`, `jsonb`, `bytea`, and `text[]` works.

### Option A — Local Docker (recommended for dev)

```bash
docker run -d --name erp-compta-test-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=erp_compta_test \
  -p 5433:5432 \
  postgres:16

# DSN: postgresql://postgres:postgres@localhost:5433/erp_compta_test
```

The volume is ephemeral — destroy the container, lose the data. Perfect
for an e2e DB.

### Option B — Supabase branch

Create a dedicated project (or a database branch) in the Supabase
dashboard. Use the **session pooler** DSN (port 5432, host
`aws-N-<region>.pooler.supabase.com`) and set `TEST_DB_SSL=true`. Direct
DSNs (`db.<ref>.supabase.co`) are IPv6-only and routinely unreachable
from local dev networks (cf. `bd memories` for the project-specific
pooler hostname).

### Option C — CI service

In `.github/workflows/ci.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: erp_compta_test
    ports: ['5432:5432']
    options: >-
      --health-cmd "pg_isready -U postgres"
      --health-interval 10s --health-timeout 5s --health-retries 10
env:
  TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/erp_compta_test
```

## Configuring the harness

1. Copy the example file:
   ```bash
   cp apps/backend/.env.test.example apps/backend/.env.test
   ```
2. Edit `apps/backend/.env.test` and pin `TEST_DATABASE_URL` to the DSN
   from the option you picked. Optional: set `TEST_DB_SSL=true` if your
   provider mandates SSL.
3. **Never commit `.env.test`** — it's covered by the root `.gitignore`
   `.env*` rule. Use `.env.test.example` for the public template.

The other 10+ env vars (`JWT_SECRET`, `MFA_ENCRYPTION_KEY`, `SMTP_*`,
`APP_BASE_URL`, …) fall back to deterministic test values set inside
[`test/setup/load-env.ts`](../apps/backend/test/setup/load-env.ts);
override them only if your CI policy forbids the defaults.

## Running

```bash
pnpm --filter backend test:e2e            # whole suite
pnpm --filter backend test:e2e -- tenant  # filter by filename pattern
```

The first run takes ~10 s because `globalSetup`
([`test/setup/global-setup.ts`](../apps/backend/test/setup/global-setup.ts))
drops the `public` schema, re-creates it, and re-applies all migrations.
Subsequent runs within the same test process re-use the schema; data is
wiped between tests by `resetTables()` in
[`test/helpers/db.ts`](../apps/backend/test/helpers/db.ts).

## Authoring a new e2e test

```ts
import { DataSource } from 'typeorm';
import { createE2eApp, type E2eAppHandle } from './helpers/app';
import { resetTables } from './helpers/db';
import { seedUserAndLogin, createOrgAndSwitch, authedJson } from './helpers/auth';

describe('e2e: my new flow', () => {
  let handle: E2eAppHandle;

  beforeAll(async () => { handle = await createE2eApp(); });
  afterAll(async () => { await handle.app.close(); });
  beforeEach(async () => {
    await resetTables(handle.app.get(DataSource));
  });

  it('does the thing', async () => {
    const alice = await seedUserAndLogin(handle.app, 'alice@e2e.test');
    const org = await createOrgAndSwitch(handle.app, alice, 'Acme');

    const res = await authedJson(
      handle.http, 'get', `/organizations/${org.organizationId}/members`,
      org.scopedAccessToken,
    );
    expect(res.status).toBe(200);
  });
});
```

Conventions:
- File suffix `*.e2e-spec.ts` (matched by `testRegex` in
  [`test/jest-e2e.json`](../apps/backend/test/jest-e2e.json)).
- Place specs under `apps/backend/test/` (any depth — the regex matches
  any file ending in `.e2e-spec.ts`).
- Use `helpers/auth.ts` for the "I need a logged-in admin in an org"
  preamble — avoid recreating that flow inline.
- Use `helpers/db.ts#resetTables` in `beforeEach` so suites don't bleed
  state into each other. The seeded catalogs (`roles`, `permissions`,
  `role_permissions`) are intentionally NOT truncated.

## Section 10 coverage roadmap

The current scaffold ships one example test:

- ✅ **10.1** `tenant-isolation.e2e-spec.ts` — token A → 404 on org B,
  audit emission validated.

Pending (each ~30 lines of spec on top of the existing helpers):

- **10.2** Permission deny-by-default — call a `@RequirePermission`
  handler without the right role, expect 403 `FORBIDDEN_PERMISSION`.
- **10.3** Last admin protection — try to downgrade the only admin,
  expect 409 `ORG_LAST_ADMIN`.
- **10.4** Refresh token reuse — rotate, replay the old token, expect
  401 `AUTH_REFRESH_REUSE` + whole family revoked.
- **10.5** Invitation single-use — accept twice, expect 409
  `INVITATION_ALREADY_USED` on the second call.
- **10.6** Invitation expiration — fast-forward via the seeded
  `expires_at`, expect 410 `INVITATION_EXPIRED`.
- **10.7** MFA activation flow — setup → verify (with a TOTP code
  generated from the returned `otpauthUri` via `otplib.authenticator`)
  → backup codes returned exactly once.
- **10.8** Error envelope — sample one error per family and assert the
  `{ data: null, error: { code, message } }` shape.
- **10.9** Coverage ≥ 80 % — the threshold is already wired in
  `apps/backend/package.json` `jest.coverageThreshold`. Once the e2e
  specs above land, `pnpm test:cov && pnpm test:e2e -- --coverage`
  combines unit + integration coverage.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `e2e suite requires TEST_DATABASE_URL` | `.env.test` not created or not loaded | `cp .env.test.example .env.test` + fill |
| `relation "..." does not exist` | Migrations didn't apply (DSN points at a fresh DB but the user lacks `CREATE` perm) | Use the `postgres` superuser or grant the test user |
| `ECONNREFUSED 127.0.0.1:5433` | Container not running | `docker start erp-compta-test-pg` |
| `ECIRCUITBREAKER` against Supabase | Supavisor lockout from a prior misconfig run | wait 10-15 min, see `bd memories supavisor` |
| Test sees stale data | A spec forgot `await resetTables(dataSource)` in `beforeEach` | Add the call |
