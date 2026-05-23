import type { Algorithm } from 'jsonwebtoken';

/**
 * JWT signing / verification constants — centralized so a future rotation
 * (algorithm bump, issuer rename, MFA challenge TTL change) only touches
 * this file. See `docs/plans/backend-auth-organizations.md` → BE-CRYPTO-03.
 *
 *  - `JWT_ALGORITHM` : HS256 per design D4 (single backend, shared secret
 *    in `JWT_SECRET`; an asymmetric scheme would require key distribution
 *    we don't have at MVP scale).
 *  - `JWT_ISSUER`    : constant `iss` claim — checked at verification so
 *    a token signed by a different system with the same secret length
 *    cannot accidentally validate.
 *  - `MFA_CHALLENGE_TTL` : short 5-min TTL on the intermediate token
 *    issued by `POST /auth/login` when the user has MFA enabled (spec:
 *    "MUST NOT issue a fully-privileged access token until MFA
 *    verification is completed").
 */
export const JWT_ALGORITHM: Algorithm = 'HS256';
export const JWT_ISSUER = 'erp-compta-auth';
export const MFA_CHALLENGE_TTL = '5m';

/**
 * `purpose` claim — discriminator that prevents using an access token
 * where an MFA challenge token is expected (and vice-versa). The spec for
 * BE-CRYPTO-03 calls out this exact test: "rejet d'un access token utilisé
 * comme challenge MFA et vice-versa (claim `purpose`)".
 */
export const JWT_PURPOSE = {
  ACCESS: 'access',
  MFA_CHALLENGE: 'mfa_challenge',
  INVITATION: 'invitation',
} as const;

export type JwtPurpose = (typeof JWT_PURPOSE)[keyof typeof JWT_PURPOSE];

/**
 * Invitation tokens (BE-INV-01) are signed JWTs carrying the org+role
 * intent. Stored hashed in `invitations.token_hash`; only the plaintext
 * (sent by email) round-trips through the JWT layer. TTL is fixed at 7
 * days per `specs/organizations/spec.md` ("expires_at = now + 7 days").
 */
export const INVITATION_TTL = '7d';

/**
 * Claim shapes for the two token kinds. `iat`/`exp` are added by
 * `jsonwebtoken` itself when signing; they are present on verified
 * payloads so we re-declare them here for downstream callers.
 *
 * Field naming follows the spec verbatim (`org_id`, `mfa_verified`):
 * the access token is consumed by guards on every request, so the
 * payload IS the public contract and must not drift.
 */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly purpose: 'access';
  readonly org_id?: string;
  readonly role?: string;
  readonly mfa_verified?: boolean;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
}

export interface MfaChallengeClaims {
  readonly sub: string;
  readonly purpose: 'mfa_challenge';
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
}

/**
 * Invitation token claims. `sub` is the inviter's `user_id` (audit
 * provenance). `invitation_id` is the lookup key — the accept flow
 * fetches the row by `(invitation_id, org_id)` and reads the email,
 * role, and status from the DB. The token never carries the invitee's
 * email: JWT claims are only base64-encoded, and the token travels
 * through SMTP / mail clients / mail-scanning infra. Keeping PII out of
 * the token prevents leaks via cached link previews, anti-phishing
 * scanners, or breached mail archives.
 *
 * Defence: even though the email is no longer in claims, an attacker
 * cannot forge a token without the HS256 secret, and a presented token
 * is matched against `invitations.token_hash` before acceptance — so
 * the integrity guarantee is unchanged.
 */
export interface InvitationTokenClaims {
  readonly sub: string;
  readonly purpose: 'invitation';
  readonly org_id: string;
  readonly role_id: string;
  readonly invitation_id: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
}

/**
 * Parse a duration string accepted by `env.validation.ts` (`/^\d+(ms|s|m|h|d|w|y)?$/i`)
 * into milliseconds. Returned by `refresh-token.config.ts` to compute
 * `expires_at = now + parseDurationToMs(JWT_REFRESH_TTL)`; jsonwebtoken
 * accepts the raw string for access-token `expiresIn`, but the refresh
 * token expiry is a database column we set ourselves and therefore needs
 * a concrete numeric duration.
 *
 * A unit-less value (e.g. `"604800"`) is interpreted as **seconds**,
 * matching jsonwebtoken's convention so the two code paths agree.
 */
const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d|w|y)?$/i;
const UNIT_TO_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_536_000_000,
};

export function parseDurationToMs(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: "${value}" — expected a value like "15m" or "7d".`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] ?? 's').toLowerCase();
  const factor = UNIT_TO_MS[unit];
  if (factor === undefined) {
    throw new Error(`Invalid duration unit: "${unit}".`);
  }
  return amount * factor;
}
