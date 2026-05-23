## ADDED Requirements

### Requirement: User signup with email and password

The system SHALL allow a new user to create an account using a unique email address and a password. The password MUST be at least 12 characters. The password MUST be stored using argon2id hashing. On successful signup, the system SHALL emit an `auth.signup` event in `auth_events` and SHALL NOT automatically create an organization — the user must either accept an invitation or create one explicitly.

#### Scenario: Successful signup
- **WHEN** a user submits `POST /auth/signup` with `{ email: "new@cabinet.ci", password: "Str0ngPassw0rd!", firstName: "Yao", lastName: "Konan" }`
- **THEN** the system creates a `users` row with `password_hash` computed via argon2id, returns `201` with `{ data: { user: { id, email, firstName, lastName } }, error: null }`, and writes an `auth.signup` event

#### Scenario: Signup with already-used email
- **WHEN** a user submits signup with an email that already exists
- **THEN** the system responds `409` with `{ data: null, error: { code: "AUTH_EMAIL_TAKEN", message: "Email already registered" } }` and does NOT reveal whether the email exists in detail (constant-time response)

#### Scenario: Signup with weak password
- **WHEN** a user submits signup with a password shorter than 12 characters
- **THEN** the system responds `422` with `{ data: null, error: { code: "AUTH_WEAK_PASSWORD", message: "Password must be at least 12 characters" } }`

### Requirement: User login with credentials

The system SHALL authenticate a user via email + password and return an access token (JWT, 15 min) and a refresh token (opaque, 7 days). If the user has MFA enabled, the response MUST indicate `mfa_required: true` and MUST NOT issue a fully-privileged access token until MFA verification is completed.

#### Scenario: Successful login without MFA
- **WHEN** a user submits `POST /auth/login` with valid credentials and MFA is not enabled
- **THEN** the system returns `200` with `{ data: { accessToken, refreshToken, user, organizations: [{ id, name, role }], mfa_required: false }, error: null }` and emits `auth.login_success`

#### Scenario: Successful credentials with MFA required
- **WHEN** a user submits valid credentials and MFA is enabled on their account
- **THEN** the system returns `200` with `{ data: { mfa_required: true, mfaChallengeToken: "..." }, error: null }`, does NOT issue an access token, and emits `auth.mfa_challenge_issued`

#### Scenario: Invalid credentials
- **WHEN** a user submits `POST /auth/login` with an incorrect password
- **THEN** the system responds `401` with `{ data: null, error: { code: "AUTH_INVALID_CREDENTIALS", message: "Invalid email or password" } }` and emits `auth.login_failed` with the source IP

### Requirement: Organization selection issues a tenant-scoped access token

After login, an access token without `org_id` SHALL only authorize endpoints under `/auth/*` and `/organizations` (list user's orgs). To access any business module, the client MUST call `POST /auth/select-organization` with the target `organizationId`, and the system SHALL issue a new access token containing `org_id` and `role` claims.

#### Scenario: User selects an organization they belong to
- **WHEN** a logged-in user calls `POST /auth/select-organization` with `{ organizationId: "org-123" }` and has an active membership
- **THEN** the system issues a new access token with claims `{ sub: userId, org_id: "org-123", role: "comptable", mfa_verified: true|false }` and returns `200` with `{ data: { accessToken } }`

#### Scenario: User selects an organization they do not belong to
- **WHEN** a logged-in user calls `POST /auth/select-organization` for an org where they have no active membership
- **THEN** the system responds `403` with `{ error: { code: "FORBIDDEN_NO_MEMBERSHIP" } }` and does NOT reveal whether the organization exists

### Requirement: Refresh token rotation with reuse detection

The system SHALL accept a refresh token at `POST /auth/refresh` and return a new access token + a new refresh token, invalidating the previous refresh token. If a refresh token that has already been used (or revoked) is presented, the system MUST invalidate the entire refresh token family for that user and emit `auth.refresh_token_reuse_detected`.

#### Scenario: Valid refresh
- **WHEN** the client presents a valid, unused refresh token
- **THEN** the system marks the old token as used, issues a new pair with the same `family_id`, and returns `200` with `{ data: { accessToken, refreshToken } }`

#### Scenario: Reuse of an already-consumed refresh token
- **WHEN** the client presents a refresh token whose `used_at` is not null
- **THEN** the system revokes all refresh tokens with the same `family_id`, returns `401` with `{ error: { code: "AUTH_REFRESH_REUSE" } }`, and emits `auth.refresh_token_reuse_detected`

### Requirement: Logout invalidates the refresh token

The system SHALL accept `POST /auth/logout` with a valid refresh token and SHALL mark that refresh token as revoked. Subsequent use of that token MUST be rejected.

#### Scenario: Successful logout
- **WHEN** an authenticated user calls `POST /auth/logout` with their refresh token in the body
- **THEN** the system sets `revoked_at = now()` on the token, responds `204`, and emits `auth.logout`

### Requirement: MFA TOTP enrollment

The system SHALL allow a user to enroll a TOTP authenticator by calling `POST /auth/mfa/setup`, which returns a base32 secret and an `otpauth://` URI suitable for QR-code rendering. The secret MUST be stored encrypted at rest with AES-256-GCM. MFA SHALL only become active after the user confirms a valid 6-digit code via `POST /auth/mfa/verify`, at which point `mfa_configs.enabled = true` and `activated_at` is set, and 10 single-use backup codes are generated and returned ONCE (hashed at rest).

#### Scenario: Setup TOTP secret
- **WHEN** an authenticated user calls `POST /auth/mfa/setup`
- **THEN** the system generates a 160-bit base32 secret, stores it encrypted in `mfa_configs.secret_encrypted` with `enabled = false`, and returns `200` with `{ data: { secret, otpauthUri } }`

#### Scenario: Verify and activate MFA
- **WHEN** the user submits a valid 6-digit TOTP code to `POST /auth/mfa/verify`
- **THEN** the system sets `enabled = true`, `activated_at = now()`, generates 10 backup codes, stores them hashed (argon2id), returns `{ data: { backupCodes: [...] } }`, and emits `auth.mfa_enabled`

#### Scenario: Verify with invalid code
- **WHEN** the user submits an incorrect TOTP code to `POST /auth/mfa/verify`
- **THEN** the system responds `401` with `{ error: { code: "AUTH_MFA_INVALID_CODE" } }`, does NOT activate MFA, and emits `auth.mfa_verification_failed`

### Requirement: Authentication events are journaled

The system SHALL record an entry in `auth_events` for the following event types, including `user_id` (nullable on signup failures), `organization_id` (nullable when not yet selected), `ip_address`, `user_agent`, and a `metadata` JSONB blob:
`auth.signup`, `auth.login_success`, `auth.login_failed`, `auth.logout`, `auth.refresh_token_reuse_detected`, `auth.mfa_challenge_issued`, `auth.mfa_enabled`, `auth.mfa_disabled`, `auth.mfa_verification_failed`, `auth.password_changed`.

#### Scenario: Failed login is journaled with IP
- **WHEN** any login attempt fails with invalid credentials
- **THEN** an `auth.login_failed` row is inserted in `auth_events` with the source IP, user agent, and the attempted email in `metadata`, even when no `user_id` can be resolved

#### Scenario: Auth events are immutable from the API
- **WHEN** any client (regardless of role) attempts to modify or delete an `auth_events` row via API
- **THEN** the system responds `403`. There is NO endpoint that allows mutation of `auth_events`; only read access for admins of the relevant organization

### Requirement: API responses follow a normalized envelope

All `/auth/*` responses SHALL follow the shape `{ data: T | null, error: { code: string, message: string, details?: object } | null }`. On success, `error` is `null`. On failure, `data` is `null` and `error.code` MUST be a stable machine-readable string from the documented error catalog.

#### Scenario: Success envelope
- **WHEN** any auth endpoint succeeds
- **THEN** the response body matches `{ data: <payload>, error: null }`

#### Scenario: Error envelope
- **WHEN** any auth endpoint fails
- **THEN** the response body matches `{ data: null, error: { code, message } }` with an HTTP status consistent with `code` (e.g., `AUTH_INVALID_CREDENTIALS` → 401, `AUTH_WEAK_PASSWORD` → 422)
