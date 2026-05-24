# Backend — ERP Compta

NestJS 10 backend for the ERP Compta SaaS platform. Multi-tenant
accounting workflow targeting OHADA jurisdictions.

## Local setup

### Prerequisites

- Node.js ≥ 20 (`engines.node` in `package.json`)
- pnpm ≥ 9 (workspace-managed from the repo root)
- A reachable Postgres instance — local Docker is fine; the canonical
  target is Supabase via the Supavisor session pooler

### Environment

Copy `.env.example` and fill in. Required variables (validated by
[`src/config/env.validation.ts`](src/config/env.validation.ts) — the
process refuses to boot if any are missing or malformed):

| Variable | Format | Notes |
|---|---|---|
| `NODE_ENV` | `development` \| `test` \| `staging` \| `production` | defaults to `development` |
| `PORT` | integer 1-65535 | defaults to `3001` |
| `DATABASE_URL` | Postgres URL | use the Supavisor session pooler when targeting Supabase; the direct DSN is IPv6-only on most providers |
| `DB_SSL` | bool-ish | `true`/`false`/`1`/`0`; required `true` for Supabase |
| `JWT_SECRET` | ≥ 32 chars | HS256 signing key for access + MFA challenge + invitation tokens |
| `JWT_ACCESS_TTL` | duration | e.g. `15m`, `1h`; default `15m` |
| `JWT_REFRESH_TTL` | duration | e.g. `7d`, `1w`; default `7d` |
| `MFA_ENCRYPTION_KEY` | base64-encoded 32 bytes | AES-256-GCM key for `mfa_configs.secret_encrypted` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | strings | dev: any values; prod: real SMTP |
| `APP_BASE_URL` | URL | used by `EmailService` to build the accept-invitation link |
| `EMAIL_DRY_RUN` | bool-ish | `true` skips the actual SMTP send and just logs the payload — recommended in dev |

> The `MFA_ENCRYPTION_KEY` MUST decode to exactly 32 bytes. Generate one
> with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

### Bootstrap

```bash
pnpm install                           # from the repo root, installs all workspace deps
pnpm --filter backend migration:run    # apply migrations 0001..0014 (Module 1 + Module 2 plan comptable)
pnpm --filter backend seed:dev         # idempotent — creates demo org + 6 users
pnpm --filter backend start:dev        # NestJS in watch mode on :3001
```

After `seed:dev`, the following demo users exist (all sharing password
`DemoDemo2026!`):

| Email | Role |
|---|---|
| `admin@erp-demo.ci` | `admin` |
| `expert@erp-demo.ci` | `expert_comptable` |
| `mission@erp-demo.ci` | `chef_mission` |
| `compta@erp-demo.ci` | `comptable` |
| `audit@erp-demo.ci` | `auditeur` |
| `client@erp-demo.ci` | `client_readonly` |

### Smoke test

```bash
curl -s http://localhost:3001/health/db
# → {"data":{"ok":true},"error":null}

curl -s -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@erp-demo.ci","password":"DemoDemo2026!"}'
# → { data: { mfa_required: false, accessToken, refreshToken, user, organizations: [...] }, error: null }
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm --filter backend start:dev` | NestJS in watch mode |
| `pnpm --filter backend build` | Compile to `dist/` |
| `pnpm --filter backend start:prod` | Run the compiled bundle |
| `pnpm --filter backend lint` | ESLint with `--max-warnings=0` |
| `pnpm --filter backend lint:fix` | Auto-fix style issues |
| `pnpm --filter backend typecheck` | `tsc --noEmit` |
| `pnpm --filter backend test` | Jest unit suite |
| `pnpm --filter backend test:cov` | Unit suite with coverage |
| `pnpm --filter backend test:e2e` | End-to-end suite (config + tests land with BE-TEST-INTEG) |
| `pnpm --filter backend migration:generate -- <Name>` | Scaffold a new migration |
| `pnpm --filter backend migration:run` | Apply pending migrations |
| `pnpm --filter backend migration:revert` | Revert the most recent migration |
| `pnpm --filter backend seed:dev` | Idempotent dev seed |

## Architecture (Module 1)

```
src/
├── common/
│   ├── decorators/        @RawResponse
│   ├── errors/            AppException, ERROR_CODES, http-status.map
│   ├── filters/           AllExceptionsFilter (BE-BOOT-06)
│   ├── interceptors/      ResponseEnvelopeInterceptor (BE-BOOT-07)
│   ├── logging/           Pino logger module (BE-BOOT-09)
│   ├── middleware/        RequestIdMiddleware (BE-BOOT-08)
│   ├── persistence/       tenant-scope: TenantId brand + assertTenantId
│   ├── time/              Clock abstraction + SystemClock + CLOCK token
│   └── types/             RequestContext (currentUser, currentOrg, …)
├── config/                env.validation (Zod) + AppConfig factory
├── database/
│   ├── data-source.ts     standalone DataSource for CLI scripts
│   ├── migrations/        0001..0010 — auth/orgs/RBAC schema
│   │                      0011..0014 — Module 2 plan comptable OHADA
│                                       (reference + per-org charts + perms)
│   └── seeds/dev-seed.ts  idempotent fixture
└── modules/
    ├── audit/             AuthEventRepository, AuthEventsService
    ├── auth/              PasswordService, EncryptionService,
    │                      JwtTokenService, RefreshTokenService,
    │                      MfaService, AuthService, AuthController,
    │                      JwtAuthGuard, @Public, @CurrentUser, @CurrentOrg
    ├── email/             EmailService (dev: dry-run; prod: BE-MAIL-02)
    ├── health/            /health/db probe
    ├── organizations/     OrganizationsService, InvitationsService,
    │                      OrganizationsController, MembersController,
    │                      InvitationsController, AcceptInvitationController,
    │                      AuthEventsController (BE-AUDIT-02)
    ├── accounting-plan/   Module 2 — ReferenceChartService,
    │                      ChartOfAccountsService, ReferenceChartController,
    │                      ChartOfAccountsController + SYSCOHADA AUDCIF seed
    └── rbac/              MembershipsService, TenantGuard, RolesGuard,
                           PermissionsGuard, @Roles, @RequirePermission
```

See [docs/error-codes.md](../../docs/error-codes.md) for the public
error catalog, [docs/rbac.md](../../docs/rbac.md) for the
role × permission matrix, and [docs/accounting-plan.md](../../docs/accounting-plan.md)
for the OHADA SYSCOHADA AUDCIF plan structure and CRUD invariants.

## Spec-driven plan

Module 1 (auth / organizations / RBAC) is tracked under
[openspec/changes/module-1-auth-organizations/](../../openspec/changes/module-1-auth-organizations/).
`tasks.md` is the canonical roadmap; the implementation tickets
(`BE-BOOT-*`, `BE-DB-*`, `BE-CRYPTO-*`, `BE-AUTH-*`, `BE-ORG-*`,
`BE-RBAC-*`, `BE-INV-*`, `BE-AUDIT-*`) reference the relevant
sections in their commit messages.
