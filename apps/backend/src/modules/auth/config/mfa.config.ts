/**
 * MFA TOTP (RFC 6238) constants — centralized so a future rotation of the
 * authenticator policy (digits, period, window) touches one file.
 *
 *  - `TOTP_DIGITS`  : 6 digits, the de-facto standard read by Google
 *                     Authenticator / Authy / 1Password.
 *  - `TOTP_PERIOD`  : 30-second time-step, RFC 6238 default.
 *  - `TOTP_WINDOW`  : ±1 step tolerance (so a code from the previous or
 *                     next slot still validates — accommodates clock
 *                     drift up to ~30s on either side).
 *  - `TOTP_ISSUER`  : human-readable issuer baked into the `otpauth://`
 *                     URI so the authenticator app shows "ERP Compta:
 *                     yao@cabinet.ci" in its UI.
 *  - `BACKUP_CODE_COUNT` : 10 single-use recovery codes, returned ONCE
 *                          at activation. Each code is 8 base32 chars
 *                          (~40 bits of entropy) — plenty for a single-
 *                          use fallback. Stored hashed with argon2id
 *                          (`PasswordService.hashPassword`).
 */

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD = 30;
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = 'ERP Compta';

export const BACKUP_CODE_COUNT = 10;
