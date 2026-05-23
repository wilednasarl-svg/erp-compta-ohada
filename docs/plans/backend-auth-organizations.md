# Plan d'implémentation backend — Module 1 : Auth & Organizations

> **Source** : `openspec/changes/module-1-auth-organizations/` (proposal.md, design.md, tasks.md, specs/auth, specs/organizations, specs/rbac).
> **Cible** : `apps/backend` (NestJS + TypeScript strict, PostgreSQL via Supabase).
> **Convention** : chaque micro-tâche porte un identifiant `BE-<SECTION>-NN`, à utiliser dans les commits, PR et issues `bd`.
>
> Règles transverses (rappel design.md) :
> - **Multi-tenant strict** : tout accès DB métier passe par un repository qui exige `organization_id`. Index composites `(organization_id, …)` partout.
> - **RBAC deny-by-default** : un endpoint sans `@RequirePermission` ni `@Roles` doit échouer en `403 RBAC_NO_POLICY_DECLARED`.
> - **Réponses normalisées** : `{ data: T | null, error: { code, message, details? } | null }`.
> - **Audit** : tout événement listé dans `specs/auth` doit appeler `AuthEventsService.record()` avec `ip`, `user_agent`, `metadata`.
> - **Tests** : couverture globale ≥ 80 % sur `modules/auth`, `modules/organizations`, `modules/rbac` (cf. tasks.md §13).
> - **Stack** : NestJS 10, TypeORM (migrations SQL versionnées), `argon2`, `jsonwebtoken`, `otplib`, `qrcode`, `class-validator` + `class-transformer`, `nodemailer`, `pino` (logs).
>
> Frontend (tasks.md §11) **non couvert ici** — sortira dans `docs/plans/frontend-auth-organizations.md`.

---

## Sommaire

1. [Bootstrap & config](#1-bootstrap--config) — `BE-BOOT-*`
2. [Models & migrations](#2-models--migrations) — `BE-DB-*`
3. [Services de crypto & tokens](#3-services-de-crypto--tokens) — `BE-CRYPTO-*`
4. [Auth core](#4-auth-core) — `BE-AUTH-*`
5. [Organizations](#5-organizations) — `BE-ORG-*`
6. [RBAC guards & decorators](#6-rbac-guards--decorators) — `BE-RBAC-*`
7. [Invitations](#7-invitations) — `BE-INV-*`
8. [Email](#8-email) — `BE-MAIL-*`
9. [Audit events](#9-audit-events) — `BE-AUDIT-*`
10. [Tests & sécurité](#10-tests--sécurité) — `BE-TEST-*`
11. [Documentation & seeds](#11-documentation--seeds) — `BE-DOC-*`
12. [Pre-merge checks](#12-pre-merge-checks) — `BE-CHECK-*`

---

## 1. Bootstrap & config

> Référence : tasks.md §1.1 → §1.7.

### BE-BOOT-01 — Initialiser le projet NestJS

- **Objectif** : créer `apps/backend` avec NestJS 10, TypeScript strict, ESLint, Prettier, configuration `tsconfig.build.json` séparée.
- **Fichiers** :
  - `apps/backend/package.json`
  - `apps/backend/tsconfig.json` (strict: true, noImplicitAny, strictNullChecks)
  - `apps/backend/tsconfig.build.json`
  - `apps/backend/.eslintrc.cjs`, `.prettierrc`
  - `apps/backend/nest-cli.json`
  - `apps/backend/src/main.ts` (bootstrap, `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))`)
  - `apps/backend/src/app.module.ts`
- **Done** :
  - `pnpm --filter backend lint` propre.
  - `pnpm --filter backend build` génère `dist/` sans warning.
  - `pnpm --filter backend start:dev` démarre sur le port `PORT` (défaut 3001).

### BE-BOOT-02 — ConfigModule + validation des env vars

- **Objectif** : chargement `.env` typé et validé au démarrage.
- **Fichiers** :
  - `apps/backend/src/config/env.validation.ts` (schema `class-validator` ou `zod`)
  - `apps/backend/src/config/configuration.ts`
  - `apps/backend/.env.example`
- **Variables requises** : `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars), `JWT_ACCESS_TTL` (défaut 15m), `JWT_REFRESH_TTL` (défaut 7d), `MFA_ENCRYPTION_KEY` (32 bytes base64), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `APP_BASE_URL`, `EMAIL_DRY_RUN` (bool).
- **Done** :
  - L'application échoue **fail-fast** au boot si une variable manque/invalide (message clair, liste les champs).
  - Tests unitaires `env.validation.spec.ts` : succès, échec, valeurs limites.

### BE-BOOT-03 — Connexion PostgreSQL via TypeORM (Supabase)

- **Objectif** : `DatabaseModule` avec pool, SSL Supabase, migrations runner.
- **Fichiers** :
  - `apps/backend/src/database/database.module.ts`
  - `apps/backend/src/database/data-source.ts` (DataSource autonome pour la CLI TypeORM)
  - `apps/backend/src/database/migrations/.gitkeep`
- **Done** :
  - `pnpm --filter backend migration:run` exécutable.
  - `migrationsRun: false` au boot (les migrations passent en CI/script séparé, pas au démarrage).
  - Healthcheck `GET /health/db` répond `{ data: { ok: true } }`.

### BE-BOOT-04 — Structure modulaire

- **Objectif** : créer l'arborescence des modules cibles.
- **Fichiers** (squelettes vides + `index.ts` barrels) :
  - `apps/backend/src/modules/auth/`
  - `apps/backend/src/modules/organizations/`
  - `apps/backend/src/modules/rbac/`
  - `apps/backend/src/modules/audit/`
  - `apps/backend/src/modules/email/`
  - `apps/backend/src/common/` (filters, interceptors, decorators, dto, errors)
- **Done** : `app.module.ts` importe les 5 modules sans erreur compile.

### BE-BOOT-05 — Catalogue d'erreurs typées

- **Objectif** : centraliser les codes d'erreur stables et le mapping HTTP.
- **Fichiers** :
  - `apps/backend/src/common/errors/error-codes.ts` (enum/const : `AUTH_INVALID_CREDENTIALS`, `AUTH_EMAIL_TAKEN`, `AUTH_WEAK_PASSWORD`, `AUTH_MFA_REQUIRED`, `AUTH_MFA_INVALID_CODE`, `AUTH_REFRESH_REUSE`, `ORG_NOT_FOUND`, `ORG_LAST_ADMIN`, `FORBIDDEN_ROLE`, `FORBIDDEN_PERMISSION`, `FORBIDDEN_NO_MEMBERSHIP`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_USED`, `INVITATION_ALREADY_PENDING`, `RBAC_NO_POLICY_DECLARED`, `RBAC_SYSTEM_ROLE_LOCKED`)
  - `apps/backend/src/common/errors/app-exception.ts` (class `AppException` portant `code`, `status`, `message`, `details?`)
  - `apps/backend/src/common/errors/http-status.map.ts`
- **Done** : test unitaire vérifie qu'un `AppException(AUTH_INVALID_CREDENTIALS)` mappe sur `401`.

### BE-BOOT-06 — Filtre d'exception global (envelope error)

- **Objectif** : convertir toute exception en `{ data: null, error: { code, message, details? } }`.
- **Fichiers** :
  - `apps/backend/src/common/filters/all-exceptions.filter.ts`
- **Comportement** :
  - `AppException` → utilise `code` et `status` directs.
  - `HttpException` Nest → mapping générique (`HTTP_400` → code générique).
  - `ValidationPipe` errors → `AUTH_VALIDATION` ou code spécifique (`AUTH_WEAK_PASSWORD` si champ password).
  - Inconnu → `INTERNAL_ERROR`, log Pino niveau `error` avec stack, **jamais** d'expo détails au client.
- **Done** : test e2e `error envelope` (tasks 10.8) couvre 401/403/404/409/422/500.

### BE-BOOT-07 — Intercepteur d'envelope de succès

- **Objectif** : wrapper toute réponse 2xx dans `{ data, error: null }`.
- **Fichiers** :
  - `apps/backend/src/common/interceptors/response-envelope.interceptor.ts`
- **Done** :
  - Bypass possible via décorateur `@RawResponse()` (ex : streaming).
  - Test unitaire vérifie qu'une réponse `{ user }` devient `{ data: { user }, error: null }`.

### BE-BOOT-08 — Intercepteur `ip` + `user-agent`

- **Objectif** : extraire `ip` (en respectant `X-Forwarded-For` derrière le reverse proxy Supabase/Vercel) et `user-agent` et les attacher à `req.context`.
- **Fichiers** :
  - `apps/backend/src/common/interceptors/request-context.interceptor.ts`
  - `apps/backend/src/common/types/request-context.ts`
- **Done** : `req.context.ip` et `req.context.userAgent` disponibles dans tout controller. Cf. tasks 9.2.

### BE-BOOT-09 — Logger Pino + corrélation request-id

- **Objectif** : logs JSON structurés, redaction des champs sensibles (`password`, `password_hash`, `authorization`, `refreshToken`, `secret_encrypted`, `backup_codes_hashed`).
- **Fichiers** :
  - `apps/backend/src/common/logging/logger.module.ts`
  - `apps/backend/src/common/middleware/request-id.middleware.ts`
- **Done** : un log de login expose `request_id`, `route`, `status`, `latency_ms` mais **jamais** le password.

---

## 2. Models & migrations

> Référence : tasks.md §2.1 → §2.11 et design.md D9. Une migration = un fichier SQL versionné.

### BE-DB-01 — Migration `organizations`

- **Fichiers** : `apps/backend/src/database/migrations/0001_create_organizations.ts`
- **Schéma** : `id UUID PK`, `name TEXT NOT NULL`, `slug TEXT NOT NULL UNIQUE`, `type TEXT CHECK (type IN ('firm','company'))`, `created_at`, `updated_at`, `deleted_at NULL`.
- **Indexes** : `UNIQUE(slug)`, `INDEX(deleted_at)`.
- **Done** : migration up/down testée.

### BE-DB-02 — Migration `users`

- **Fichiers** : `0002_create_users.ts`
- **Schéma** : `id UUID PK`, `email CITEXT NOT NULL UNIQUE`, `password_hash TEXT NOT NULL`, `first_name TEXT`, `last_name TEXT`, `locale TEXT DEFAULT 'fr-FR'`, `is_active BOOLEAN DEFAULT true`, timestamps + `deleted_at`.
- **Indexes** : `UNIQUE(email)`.
- **Done** : `CITEXT` actif (extension) ; conflit `Email@x.com` vs `email@x.com` rejeté.

### BE-DB-03 — Migration `roles` + seed des 6 rôles

- **Fichiers** : `0003_create_roles.ts`
- **Schéma** : `id UUID PK`, `code TEXT UNIQUE`, `name TEXT`, `description TEXT`, `is_system BOOLEAN DEFAULT true`.
- **Seed** : `admin`, `expert_comptable`, `chef_mission`, `comptable`, `auditeur`, `client_readonly` (cf. specs/rbac §"Six seeded business roles").
- **Done** : 6 lignes après migration ; test `roles are seeded on fresh install`.

### BE-DB-04 — Migration `permissions` + seed catalogue

- **Fichiers** : `0004_create_permissions.ts`
- **Schéma** : `id UUID PK`, `code TEXT UNIQUE`, `description TEXT`.
- **Seed** : `organizations.read`, `organizations.update`, `organizations.invite`, `organizations.manage_members`, `users.manage_roles`, `users.suspend`, `accounting.read`, `accounting.write`, `accounting.validate`, `accounting.sign`, `audit.read`, `audit.export`, `mfa.manage_self` (cf. specs/rbac §"Seeded permission catalog").

### BE-DB-05 — Migration `role_permissions` + seed mappings

- **Fichiers** : `0005_create_role_permissions.ts`
- **Schéma** : `(role_id FK, permission_id FK, PRIMARY KEY(role_id, permission_id))`.
- **Seed** : mapping exact de specs/rbac (admin = tout, expert_comptable = tout sauf `organizations.manage_members`, etc.).
- **Done** : test `permissions are seeded with role mappings` (specs/rbac).

### BE-DB-06 — Migration `memberships`

- **Fichiers** : `0006_create_memberships.ts`
- **Schéma** : `id UUID PK`, `user_id FK`, `organization_id FK`, `role_id FK`, `status TEXT CHECK IN ('active','suspended')`, timestamps. `UNIQUE(user_id, organization_id)`.
- **Indexes** : `(organization_id)`, `(user_id)`, composite `(organization_id, status)`.

### BE-DB-07 — Migration `invitations`

- **Fichiers** : `0007_create_invitations.ts`
- **Schéma** : `id`, `organization_id FK`, `email`, `role_id FK`, `token_hash TEXT UNIQUE`, `status TEXT CHECK IN ('pending','accepted','expired','revoked')`, `invited_by FK→users`, `expires_at`, `accepted_at NULL`, timestamps.
- **Indexes** : `(organization_id)`, `(token_hash)`, `(organization_id, email, status)` pour détection doublon `pending`.

### BE-DB-08 — Migration `refresh_tokens`

- **Fichiers** : `0008_create_refresh_tokens.ts`
- **Schéma** : `id`, `user_id FK`, `organization_id FK NULL`, `token_hash TEXT UNIQUE`, `family_id UUID NOT NULL`, `used_at NULL`, `expires_at`, `revoked_at NULL`, timestamps.
- **Indexes** : `(user_id)`, `(family_id)`, `(token_hash)`.

### BE-DB-09 — Migration `mfa_configs`

- **Fichiers** : `0009_create_mfa_configs.ts`
- **Schéma** : `id`, `user_id FK UNIQUE`, `secret_encrypted BYTEA`, `enabled BOOLEAN DEFAULT false`, `activated_at NULL`, `backup_codes_hashed TEXT[]`, timestamps.

### BE-DB-10 — Migration `auth_events` + indexes

- **Fichiers** : `0010_create_auth_events.ts`
- **Schéma** : `id`, `user_id NULL`, `organization_id NULL`, `event_type TEXT NOT NULL`, `ip_address INET`, `user_agent TEXT`, `metadata JSONB`, `created_at`.
- **Indexes** : `(user_id, created_at DESC)`, `(organization_id, created_at DESC)`, `(event_type, created_at DESC)`.
- **Contrainte CHECK** : `event_type` reste libre (extensible Module 7) mais documenté.

### BE-DB-11 — Entities TypeORM + repositories

- **Fichiers** :
  - `apps/backend/src/modules/organizations/entities/organization.entity.ts`
  - `apps/backend/src/modules/auth/entities/{user,refresh-token,mfa-config}.entity.ts`
  - `apps/backend/src/modules/rbac/entities/{role,permission,role-permission,membership}.entity.ts`
  - `apps/backend/src/modules/organizations/entities/invitation.entity.ts`
  - `apps/backend/src/modules/audit/entities/auth-event.entity.ts`
  - Repositories `…/repositories/<entity>.repository.ts` (toujours via méthodes typées, jamais `find()` brut sans `organization_id` quand applicable).
- **Done** :
  - Aucune méthode publique d'un repository métier n'accepte d'omettre `organizationId` lorsque la table porte cette colonne.
  - Lint maison ou test architecture (`dependency-cruiser`) vérifie l'invariant.

---

## 3. Services de crypto & tokens

> Référence : tasks.md §3, §4. Design D3, D4, D6.

### BE-CRYPTO-01 — `PasswordService` (argon2id)

- **Fichiers** : `apps/backend/src/modules/auth/services/password.service.ts`
- **API** : `hash(plain): Promise<string>`, `verify(plain, hash): Promise<boolean>` (compare en temps constant).
- **Paramètres OWASP 2024** : `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`, `type: argon2id`.
- **Done** : test roundtrip ; test `verify` faux retourne `false` sans throw ; test param mismatch → rejection contrôlée.

### BE-CRYPTO-02 — `EncryptionService` (AES-256-GCM)

- **Fichiers** : `apps/backend/src/common/crypto/encryption.service.ts`
- **API** : `encrypt(plain: string): Buffer`, `decrypt(buf: Buffer): string` ; format stocké `iv(12) | tag(16) | ciphertext`.
- **Clé** : `MFA_ENCRYPTION_KEY` 32 bytes base64.
- **Done** : test roundtrip ; test tampering (modif d'un byte du ciphertext) → exception ; test mauvaise clé → exception.

### BE-CRYPTO-03 — `JwtTokenService`

- **Fichiers** : `apps/backend/src/modules/auth/services/jwt-token.service.ts`
- **API** :
  - `signAccessToken(payload: { sub: string; org_id?: string; role?: string; mfa_verified?: boolean }): string` (TTL = `JWT_ACCESS_TTL`).
  - `verifyAccessToken(token: string): JwtClaims` (throw `AppException(AUTH_INVALID_TOKEN, 401)` si invalide).
  - `signMfaChallengeToken(userId): string` (TTL court 5 min, claim `purpose: 'mfa_challenge'`).
- **Algo** : HS256, secret = `JWT_SECRET`.
- **Done** : test signature/vérif, test expiration, test rejet d'un access token utilisé comme challenge MFA et vice-versa (claim `purpose`).

### BE-CRYPTO-04 — `RefreshTokenService` (rotation + détection réutilisation)

- **Fichiers** : `apps/backend/src/modules/auth/services/refresh-token.service.ts`
- **API** :
  - `issue({ userId, orgId?, familyId? }): { token, familyId, expiresAt }` — token opaque 256 bits (`crypto.randomBytes(32)`), stocké hashé SHA-256 dans `refresh_tokens.token_hash`.
  - `rotate(presentedToken): { accessToken, refreshToken }` — si `used_at != null` ou `revoked_at != null` → `revokeFamily(familyId)` + `AuthEventsService.record('auth.refresh_token_reuse_detected')` + throw `AppException(AUTH_REFRESH_REUSE, 401)`.
  - `revoke(token)`, `revokeFamily(familyId)`.
- **Done** :
  - Test : rotation valide → ancien `used_at` set, nouveau émis même `family_id`.
  - Test : réutilisation détectée → toute la famille `revoked_at` set.
  - Test : token expiré → `401`.

---

## 4. Auth core

> Référence : tasks.md §5 et specs/auth.

### BE-AUTH-01 — DTO et validation

- **Fichiers** : `apps/backend/src/modules/auth/dto/{signup,login,select-organization,refresh,mfa-setup,mfa-verify,mfa-disable,accept-invitation}.dto.ts`
- **Règles** :
  - `password` : `@MinLength(12)`, pas de complexité forcée (NIST 800-63B).
  - `email` : `@IsEmail()` + normalisé en lowercase via transformer.
  - `roleCode`, `organizationId` : `@IsUUID()` / `@IsString()`.
- **Done** : test `signup with weak password` → `422 AUTH_WEAK_PASSWORD`.

### BE-AUTH-02 — `POST /auth/signup`

- **Fichiers** :
  - `apps/backend/src/modules/auth/controllers/auth.controller.ts` (méthode `signup`)
  - `apps/backend/src/modules/auth/services/auth.service.ts` (`signup()`)
- **Comportement** : hash argon2 → insert user → `AuthEventsService.record('auth.signup', { userId, ip, ua })` → `201 { data: { user: { id, email, firstName, lastName } } }`. Pas d'organisation créée automatiquement.
- **Réponse constant-time** : si email déjà pris → `409 AUTH_EMAIL_TAKEN` mais branche timing-equalized (`await passwordService.hash('dummy')` pour égaliser).
- **Done** : 3 scenarios specs/auth couverts.

### BE-AUTH-03 — `POST /auth/login`

- **Fichiers** : même controller/service.
- **Comportement** :
  1. Récupérer user par email (case-insensitive). Si absent → `passwordService.verify('dummy')` pour timing-equalize → `401 AUTH_INVALID_CREDENTIALS` + `auth.login_failed`.
  2. Vérifier `is_active`. Si suspendu → `401 AUTH_USER_SUSPENDED` + event.
  3. Vérifier password. Échec → `auth.login_failed` (avec `email` en metadata, IP).
  4. Si `mfa_configs.enabled = true` → renvoyer `{ data: { mfa_required: true, mfaChallengeToken } }` + `auth.mfa_challenge_issued`, **pas** d'access token.
  5. Sinon : `signAccessToken({ sub: user.id, mfa_verified: false })` + `refreshTokenService.issue({ userId })` + liste des organisations actives `{ id, name, role }` + `auth.login_success`.
- **Done** : 3 scenarios specs/auth (success no MFA, MFA required, invalid credentials).

### BE-AUTH-04 — `POST /auth/select-organization`

- **Fichiers** : auth.controller + auth.service.
- **Comportement** :
  - Vérifier `Membership(user_id, organizationId, status='active')`. Sinon → `403 FORBIDDEN_NO_MEMBERSHIP` (sans révéler si l'org existe).
  - Émettre nouveau access token avec `org_id`, `role`, `mfa_verified` hérité du token courant.
  - Émettre nouveau refresh token lié à `organization_id` (même `family_id` que le refresh courant).
- **Done** : scenario `User selects an organization they do not belong to` couvert.

### BE-AUTH-05 — `POST /auth/refresh`

- **Fichiers** : auth.controller + auth.service.
- **Comportement** : déléguer à `RefreshTokenService.rotate()`. Sur succès → nouveau access + refresh.
- **Done** : scenario `Reuse of an already-consumed refresh token` (specs/auth) couvert.

### BE-AUTH-06 — `POST /auth/logout`

- **Fichiers** : auth.controller + auth.service.
- **Comportement** : `RefreshTokenService.revoke(token)` → `204` → `auth.logout`.
- **Done** : test e2e logout puis refresh → `401 AUTH_REFRESH_REUSE` (token révoqué).

### BE-AUTH-07 — `POST /auth/mfa/setup`

- **Fichiers** :
  - `apps/backend/src/modules/auth/services/mfa.service.ts`
  - `apps/backend/src/modules/auth/controllers/auth.controller.ts` (méthode mfa.setup)
- **Comportement** :
  - `otplib.authenticator.generateSecret()` (160 bits base32).
  - Chiffrer via `EncryptionService.encrypt`, upsert `mfa_configs` avec `enabled = false`.
  - Construire `otpauthUri` : `otpauth://totp/Acme:user@x.com?secret=...&issuer=ERPCompta`.
  - Retourner `{ secret, otpauthUri }` (le secret base32 brut **n'est renvoyé qu'à ce moment**).
- **Auth** : nécessite access token valide (`JwtAuthGuard`), pas de tenant.
- **Done** : test : `secret_encrypted` n'est pas le secret en clair.

### BE-AUTH-08 — `POST /auth/mfa/verify`

- **Comportement** :
  - Décrypter le secret, valider via `otplib.authenticator.check(code, secret)` avec window=1.
  - Si OK : `enabled = true`, `activated_at = now()`, générer 10 backup codes (`crypto.randomBytes(8).toString('hex')`), les hasher en argon2id et les stocker dans `backup_codes_hashed[]`. Renvoyer les **codes en clair une seule fois** + `auth.mfa_enabled`.
  - Si KO : `401 AUTH_MFA_INVALID_CODE` + `auth.mfa_verification_failed`, sans incrémenter l'activation.
- **Done** : 2 scenarios specs/auth couverts ; test : les backup codes stockés ne matchent pas en clair.

### BE-AUTH-09 — `POST /auth/mfa/disable`

- **Comportement** : exige un code TOTP valide **ou** un backup code valide → set `enabled = false`, vide les backup codes hashés → `auth.mfa_disabled`.
- **Done** : test : tentative disable sans code TOTP → `401`.

### BE-AUTH-10 — `POST /auth/mfa/challenge`

- **Comportement** : second step du login MFA. Le client présente `mfaChallengeToken` + `code` (ou backup code). Si valide → délivrer access token avec `mfa_verified: true` + refresh token. Consommer le backup code si utilisé (supprimer de l'array).
- **Done** : test : `mfaChallengeToken` ne peut être utilisé qu'une fois.

### BE-AUTH-11 — `AuthModule` exports & wiring

- **Fichiers** : `apps/backend/src/modules/auth/auth.module.ts`
- **Done** : `JwtTokenService` exporté pour les guards RBAC ; `AuthEventsService` injecté ; controller protégé par `@UseFilters(AllExceptionsFilter)`.

---

## 5. Organizations

> Référence : tasks.md §6 et specs/organizations.

### BE-ORG-01 — `OrganizationsService` (CRUD + slug)

- **Fichiers** :
  - `apps/backend/src/modules/organizations/services/organizations.service.ts`
  - `apps/backend/src/modules/organizations/services/slug.util.ts`
- **API** : `create({ name, type, creatorUserId })`, `findById(orgId, viewer)`, `update(orgId, dto, actor)`, `listForUser(userId)`.
- **Slug** : kebab-case + suffixe numérique en cas de collision (loop jusqu'à insertion réussie via `UNIQUE` + retry).
- **Done** : scenarios `Create a new organization`, `Slug collision`.

### BE-ORG-02 — `POST /organizations`

- **Fichiers** : `apps/backend/src/modules/organizations/controllers/organizations.controller.ts`
- **Auth** : `JwtAuthGuard` seul (pas de `TenantGuard`, on n'a pas encore d'org sélectionnée).
- **Done** : crée org + membership admin dans une **transaction**. Émet `organizations.created`.

### BE-ORG-03 — `GET /organizations`

- **Comportement** : liste les orgs où le user a une membership `active`. Renvoie `{ id, name, slug, role }`.
- **Auth** : `JwtAuthGuard` (sans tenant).
- **Done** : 2 scenarios specs/organizations couverts (membre / sans membership).

### BE-ORG-04 — `PATCH /organizations/:id`

- **Auth** : `JwtAuthGuard` + `TenantGuard` + `@Roles('admin')`.
- **Comportement** : update `name` uniquement ; ignore `slug` ; si body ne contient que `slug` → `422 AUTH_VALIDATION` avec message explicite.
- **Audit** : `organizations.updated`.
- **Done** : 3 scenarios specs/organizations couverts.

### BE-ORG-05 — `GET /organizations/:id/members`

- **Auth** : `@RequirePermission('organizations.read')`.
- **Comportement** : retourne `{ userId, email, firstName, lastName, role, status }[]` pour l'org. Pagination.
- **Done** : test : un rôle sans permission `organizations.read` → `403 FORBIDDEN_PERMISSION`.

### BE-ORG-06 — `PATCH /organizations/:id/members/:userId` (changement de rôle)

- **Auth** : `@RequirePermission('users.manage_roles')` (admin only via mapping seed).
- **Comportement** :
  1. Si downgrade admin → vérifier invariant `ORG_LAST_ADMIN` (cf. BE-RBAC-07).
  2. Sinon : update membership.role_id, émettre `organizations.role_changed` avec `from_role`, `to_role`, `actor_user_id`, `target_user_id`.
- **Done** : scenario `Last admin attempts to downgrade themselves` couvert (`409 ORG_LAST_ADMIN`).

### BE-ORG-07 — `DELETE /organizations/:id/members/:userId`

- **Auth** : `@RequirePermission('organizations.manage_members')`.
- **Comportement** : refuse si target est le dernier admin actif → `409 ORG_LAST_ADMIN`. Sinon set `status = 'suspended'` (soft) ou supprime selon décision produit (par défaut suspend pour préserver l'historique).
- **Audit** : `organizations.member_removed`.

### BE-ORG-08 — `OrganizationsModule` wiring

- **Fichiers** : `organizations.module.ts`
- **Done** : exporte les services nécessaires aux invitations.

---

## 6. RBAC guards & decorators

> Référence : tasks.md §7 et specs/rbac.

### BE-RBAC-01 — `JwtAuthGuard`

- **Fichiers** : `apps/backend/src/modules/rbac/guards/jwt-auth.guard.ts`
- **Comportement** : extrait `Authorization: Bearer …`, vérifie via `JwtTokenService.verifyAccessToken`, attache `req.currentUser = { id, orgId?, role?, mfaVerified }`. Échec → `401 AUTH_INVALID_TOKEN`.
- **Skippable** via décorateur `@Public()`.

### BE-RBAC-02 — `TenantGuard`

- **Fichiers** : `apps/backend/src/modules/rbac/guards/tenant.guard.ts`
- **Comportement** :
  - Lit `:id` ou `:organizationId` dans `req.params`.
  - Compare à `currentUser.orgId`. Si mismatch → `AuthEventsService.record('auth.cross_tenant_attempt', { userId, attemptedOrgId, currentOrgId, ip, ua })` puis throw `AppException(ORG_NOT_FOUND, 404)` (**fail closed sans disclosure**).
  - Si `orgId` absent du token → `403 AUTH_ORG_NOT_SELECTED`.
  - Charge la `Membership` active, attache `req.currentMembership`.
- **Done** : scenario `User with token for org A queries org B` (specs/organizations & rbac).

### BE-RBAC-03 — Décorateurs `@Roles` et `@RequirePermission`

- **Fichiers** :
  - `apps/backend/src/modules/rbac/decorators/roles.decorator.ts`
  - `apps/backend/src/modules/rbac/decorators/require-permission.decorator.ts`
  - `apps/backend/src/modules/rbac/decorators/public.decorator.ts`
  - `apps/backend/src/modules/rbac/decorators/{current-user,current-org,current-membership}.decorator.ts`
- **Done** : utilisables via `Reflector` côté guards.

### BE-RBAC-04 — `RolesGuard`

- **Fichiers** : `apps/backend/src/modules/rbac/guards/roles.guard.ts`
- **Comportement** : si `@Roles(...)` présent et `currentMembership.role.code` n'est pas dedans → `403 FORBIDDEN_ROLE`.

### BE-RBAC-05 — `PermissionsGuard`

- **Fichiers** : `apps/backend/src/modules/rbac/guards/permissions.guard.ts`
- **Comportement** :
  - Charge le set des permissions du rôle via `PermissionsCacheService` (cache mémoire 5 min, invalidation sur seed/role_permissions change).
  - Si `@RequirePermission('code')` absent **et** `@Roles(...)` absent **et** pas `@Public()` → `403 RBAC_NO_POLICY_DECLARED` (deny-by-default).
  - Si permission requise non détenue → `403 FORBIDDEN_PERMISSION` avec `message: "Missing permission <code>"`.
- **Done** : scenarios specs/rbac §"Authorization is enforced by a single guard layer" (3 scenarios).

### BE-RBAC-06 — Enregistrement global du pipeline de guards

- **Fichiers** : `apps/backend/src/app.module.ts`
- **Comportement** : `APP_GUARD` × 4 dans l'ordre `JwtAuthGuard → TenantGuard → RolesGuard → PermissionsGuard`. `@Public()` bypass tout, `@Roles`/`@RequirePermission` activent les checks correspondants.

### BE-RBAC-07 — Invariant "au moins un admin actif"

- **Fichiers** : `apps/backend/src/modules/rbac/services/last-admin.guard.service.ts`
- **API** : `ensureNotLastAdmin(orgId, targetUserId)` → throw `AppException(ORG_LAST_ADMIN, 409)`.
- **Appelé depuis** : `BE-ORG-06`, `BE-ORG-07`, futur endpoint self-removal.
- **Done** : scenarios `Last admin attempts to downgrade themselves` + `Last admin attempts to leave` couverts.

### BE-RBAC-08 — Verrouillage des rôles système

- **Comportement** : aucun endpoint CRUD sur `roles` n'est exposé. Si un futur endpoint est ajouté, il doit refuser DELETE/PATCH sur `is_system = true` → `403 RBAC_SYSTEM_ROLE_LOCKED`.
- **Done** : test (specs/rbac §"System role cannot be deleted via API") en place même si l'endpoint n'existe pas encore (vérif qu'aucune route ne le permet).

### BE-RBAC-09 — `PermissionsCacheService`

- **Fichiers** : `apps/backend/src/modules/rbac/services/permissions-cache.service.ts`
- **API** : `getPermissionsForRole(roleId): Promise<Set<string>>`. TTL 5 min ; busting manuel possible.
- **Done** : test : modification de `role_permissions` invalide le cache.

---

## 7. Invitations

> Référence : tasks.md §5.9, §6.4–6.6 ; specs/organizations §Send/Accept invitation ; design D7.

### BE-INV-01 — `InvitationsService`

- **Fichiers** : `apps/backend/src/modules/organizations/services/invitations.service.ts`
- **API** :
  - `create({ orgId, email, roleCode, invitedBy })` → vérifie doublon `pending` → `409 INVITATION_ALREADY_PENDING` ; sinon génère token JWT (claims `{ orgId, email, roleCode, exp: now+7d, jti }`), hash SHA-256 du token complet pour `token_hash`, insert `invitations` `status='pending'`, dispatche email via `EmailService`, émet `organizations.invitation_sent`.
  - `revoke(invitationId, orgId)` → admin only, set `status='revoked'`, émet `organizations.invitation_revoked`.
  - `listPending(orgId)`.
  - `acceptByToken(token, { signupDto? })` → vérif JWT + lookup par `token_hash` ; si expiré → `410 INVITATION_EXPIRED` + set `status='expired'` ; si `accepted` → `409 INVITATION_ALREADY_USED` ; si `revoked` → `409 INVITATION_REVOKED` ; sinon transaction : crée user si absent (exige `signupDto`), crée membership, set `status='accepted'` + `accepted_at`, émet `organizations.invitation_accepted` (+ `auth.signup` si nouveau user).

### BE-INV-02 — `POST /organizations/:id/invitations`

- **Auth** : `@RequirePermission('organizations.invite')`.
- **Done** : 3 scenarios specs/organizations (admin invite, non-admin, duplicate pending).

### BE-INV-03 — `GET /organizations/:id/invitations`

- **Auth** : `@RequirePermission('organizations.invite')` (admin only via mapping seed).
- **Comportement** : liste pending ; paginé.

### BE-INV-04 — `DELETE /organizations/:id/invitations/:invitationId`

- **Auth** : `@RequirePermission('organizations.invite')`.
- **Done** : 404 si l'invitation appartient à une autre org.

### BE-INV-05 — `POST /auth/invitations/accept`

- **Fichiers** : auth.controller + appel `InvitationsService.acceptByToken`.
- **Auth** : `@Public()` (peut être appelé sans token, mais si access token présent, vérifie email match).
- **Done** : 4 scenarios specs/organizations (existing user, new user with signup, expired, reused).

---

## 8. Email

> Référence : tasks.md §8.

### BE-MAIL-01 — `EmailService` (nodemailer + dry-run)

- **Fichiers** : `apps/backend/src/modules/email/email.service.ts`
- **API** : `send({ to, subject, html, text, template?, vars? })`.
- **Mode dry-run** : si `EMAIL_DRY_RUN=true`, n'envoie rien mais log + stocke le dernier message dans un buffer en mémoire (testable).
- **Done** : test `send` en dry-run capture `to`, `subject`, contenu.

### BE-MAIL-02 — Template invitation

- **Fichiers** :
  - `apps/backend/src/modules/email/templates/invitation.html.ts`
  - `apps/backend/src/modules/email/templates/invitation.text.ts`
- **Variables** : `inviterName`, `orgName`, `acceptUrl` (= `${APP_BASE_URL}/accept-invitation?token=<token>`), `expiresAt`.
- **Done** : test rendu HTML + texte.

### BE-MAIL-03 — Wiring vers `InvitationsService.create`

- **Done** : appel `emailService.send` après insert DB (jamais avant — `INSERT` doit précéder l'envoi).

---

## 9. Audit events

> Référence : tasks.md §9 ; specs/auth §"Authentication events are journaled".

### BE-AUDIT-01 — `AuthEventsService.record()`

- **Fichiers** : `apps/backend/src/modules/audit/services/auth-events.service.ts`
- **API** : `record(eventType: string, ctx: { userId?, organizationId?, ip, userAgent, metadata? }): Promise<void>` — fire-and-log-on-error, jamais throw vers le caller (un échec d'audit ne doit pas casser un login).
- **Done** : test : si insert échoue, l'erreur est loggée niveau `error` mais la méthode renvoie `void`.

### BE-AUDIT-02 — Couverture des appels `record()`

- **Endroits** :
  - `auth.signup`, `auth.login_success`, `auth.login_failed`, `auth.logout`, `auth.refresh_token_reuse_detected`
  - `auth.mfa_challenge_issued`, `auth.mfa_enabled`, `auth.mfa_disabled`, `auth.mfa_verification_failed`, `auth.password_changed`
  - `auth.cross_tenant_attempt` (depuis `TenantGuard`)
  - `organizations.created`, `organizations.updated`, `organizations.invitation_sent`, `organizations.invitation_accepted`, `organizations.invitation_revoked`, `organizations.role_changed`, `organizations.member_removed`
- **Done** : test e2e par event vérifie qu'une ligne `auth_events` est créée.

### BE-AUDIT-03 — `GET /organizations/:id/auth-events`

- **Auth** : `@RequirePermission('audit.read')` + `TenantGuard`.
- **Comportement** : lecture seule, paginé (`?limit`, `?cursor` = `created_at, id`).
- **Done** : test : événements cross-org filtrés.

### BE-AUDIT-04 — Immuabilité

- **Comportement** : pas d'endpoint PATCH/DELETE sur `auth_events`. Niveau DB : aucun `UPDATE`/`DELETE` dans le code applicatif (vérifié par grep CI).
- **Done** : scenario `Auth events are immutable from the API` (specs/auth) — test e2e tente `PATCH /…/auth-events/:id` → `404`.

---

## 10. Tests & sécurité

> Référence : tasks.md §10.

### BE-TEST-01 — Setup harness e2e + DB jetable

- **Fichiers** :
  - `apps/backend/test/e2e/setup.ts` (lance migrations sur base test, seed roles/permissions)
  - `apps/backend/test/e2e/fixtures.ts` (helpers `createUser`, `createOrg`, `loginAs`, `selectOrg`)
  - `apps/backend/jest-e2e.config.ts`
- **Done** : `pnpm --filter backend test:e2e` démarre, isolation entre tests garantie (truncate ou transactions).

### BE-TEST-02 — Tenant isolation

- **Cible** : tasks 10.1 + specs/organizations §"Multi-tenant data isolation".
- **Comportement testé** : token org A → `GET /organizations/<orgB>/members` → `404` + event `auth.cross_tenant_attempt`.

### BE-TEST-03 — Deny by default

- **Cible** : tasks 10.2 + specs/rbac §"Endpoint without explicit permission declaration".
- **Implem test** : fixture d'un controller bidon `__test/no-policy` enregistré dans un module dédié à l'env test → `403 RBAC_NO_POLICY_DECLARED`.

### BE-TEST-04 — Last admin protection

- **Cible** : tasks 10.3.
- **Comportement** : org avec un seul admin → downgrade → `409 ORG_LAST_ADMIN`. Idem suppression.

### BE-TEST-05 — Refresh token reuse

- **Cible** : tasks 10.4. Émet 2 paires (rotate), rejoue l'ancien → `401 AUTH_REFRESH_REUSE`, vérifie que tous les tokens de la famille ont `revoked_at != null`.

### BE-TEST-06 — Invitation single-use

- **Cible** : tasks 10.5. Accept deux fois le même token → `409 INVITATION_ALREADY_USED`.

### BE-TEST-07 — Invitation expiration

- **Cible** : tasks 10.6. Backdate `expires_at` à J-1 → `410 INVITATION_EXPIRED`, status passe à `expired`.

### BE-TEST-08 — MFA activation flow

- **Cible** : tasks 10.7. Setup → verify avec code TOTP calculé en test (via `otplib.authenticator.generate(secret)`) → `enabled = true`, 10 backup codes renvoyés une seule fois et hashés en DB.

### BE-TEST-09 — Error envelope

- **Cible** : tasks 10.8. Pour chaque code d'erreur du catalogue, un test e2e force le scénario et vérifie `{ data: null, error: { code, message } }` + status HTTP.

### BE-TEST-10 — Couverture ≥ 80 %

- **Cible** : tasks 10.9 + 13.1.
- **Done** : `pnpm --filter backend test:cov` ≥ 80 % sur `modules/auth`, `modules/organizations`, `modules/rbac`. Seuil bloquant dans `jest.config.ts` (`coverageThreshold`).

### BE-TEST-11 — Tests architecturaux

- **Comportement** : `dependency-cruiser` ou script ad-hoc :
  - Aucun controller métier sans `@RequirePermission` ou `@Roles` ou `@Public`.
  - Aucune méthode de repository métier sans paramètre `organizationId` quand l'entité le porte.
  - Aucune occurrence de `console.log` (logger Pino obligatoire).

### BE-TEST-12 — Revue sécurité

- **Cible** : tasks 13.4.
- **Action** : invoquer `security-reviewer` agent sur `modules/auth`, `modules/rbac`, migrations DB. Documenter les findings dans la PR.

### BE-TEST-13 — Revue code globale

- **Cible** : tasks 13.5. Agent `code-reviewer` sur l'ensemble du module.

---

## 11. Documentation & seeds

> Référence : tasks.md §12.

### BE-DOC-01 — Catalogue d'erreurs

- **Fichiers** : `docs/error-codes.md`
- **Contenu** : table `code | http | message par défaut | description | déclencheurs`. Source de vérité pour le frontend.

### BE-DOC-02 — Matrice RBAC

- **Fichiers** : `docs/rbac.md`
- **Contenu** : matrice rôles × permissions avec mapping exact, et la table des endpoints → permission requise.

### BE-DOC-03 — README backend

- **Fichiers** : `apps/backend/README.md`
- **Contenu** : prérequis, install, `.env.example`, commandes `migration:run`, `migration:revert`, `seed:dev`, `test`, `test:e2e`, `test:cov`, `lint`, `typecheck`.

### BE-DOC-04 — Script de seed dev

- **Fichiers** : `apps/backend/src/database/seeds/dev-seed.ts`
- **Contenu** :
  - 1 org `demo-cabinet` type `firm`
  - 1 admin (`admin@demo.ci` / `DemoAdmin1234!`)
  - 1 expert_comptable, 1 comptable, 1 auditeur, 1 client_readonly
  - Tous les memberships actifs
- **Exposé** via `pnpm --filter backend seed:dev`.
- **Done** : run idempotent (re-run = no-op).

---

## 12. Pre-merge checks

> Référence : tasks.md §13.

### BE-CHECK-01 — Quality gates locaux

- `pnpm --filter backend lint`
- `pnpm --filter backend typecheck`
- `pnpm --filter backend test --coverage` (seuil 80 %)
- `pnpm --filter backend test:e2e`
- `pnpm --filter backend build`

### BE-CHECK-02 — OpenSpec validation

- `openspec status --change "module-1-auth-organizations"` → `isComplete: true`.
- `openspec validate module-1-auth-organizations --strict`.

### BE-CHECK-03 — Security review pass

- Reprend BE-TEST-12 sous forme de gate PR. Tout finding `CRITICAL` ou `HIGH` doit être résolu avant merge.

### BE-CHECK-04 — Beads close-out

- Toutes les issues `bd` liées (`BE-BOOT-*`, `BE-DB-*`, etc.) sont closes avec `bd close`.
- `bd stats` montre 0 issue `in_progress` sur la change.

### BE-CHECK-05 — Pre-merge final

- `git pull --rebase` puis `git push` (cf. CLAUDE.md "Session Completion").
- PR créée avec sommaire des micro-tâches, lien vers `openspec/changes/module-1-auth-organizations/`, et test plan reprenant BE-TEST-01 → 11.

---

## Annexe — Cartographie tasks.md ↔ micro-tâches

| tasks.md | Micro-tâches |
|---|---|
| 1.1–1.7 | BE-BOOT-01 → 09 |
| 2.1–2.11 | BE-DB-01 → 11 |
| 3.1–3.3 | BE-CRYPTO-01, 02 |
| 4.1–4.4 | BE-CRYPTO-03, 04 |
| 5.1–5.9 | BE-AUTH-01 → 11 |
| 6.1–6.8 | BE-ORG-01 → 08 |
| 7.1–7.7 | BE-RBAC-01 → 09 |
| 8.1–8.3 | BE-MAIL-01 → 03 |
| 9.1–9.5 | BE-AUDIT-01 → 04 |
| 10.1–10.9 | BE-TEST-01 → 13 |
| 12.1–12.4 | BE-DOC-01 → 04 |
| 13.1–13.5 | BE-CHECK-01 → 05 |
| 11.* (frontend) | **Hors scope** — voir `docs/plans/frontend-auth-organizations.md` (à créer). |
