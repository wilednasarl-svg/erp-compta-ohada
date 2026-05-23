import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * MFA code carried by `POST /auth/mfa/verify` and `POST /auth/mfa/disable`.
 *
 * Accepts either:
 *   - a 6-digit TOTP (RFC 6238), or
 *   - a `XXXXX-XXXXX` backup code (the format produced by
 *     `MfaService.verifyAndEnable`).
 *
 * The pattern is intentionally permissive at the DTO layer — the
 * service does the authoritative verify against the encrypted secret /
 * stored backup-code hashes and uses a generic `AUTH_MFA_INVALID_CODE`
 * (401) error so we don't leak which branch matched or failed.
 */
export class MfaCodeDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9-]+$/u, {
    message: 'code must be a 6-digit TOTP or a XXXXX-XXXXX backup code',
  })
  code!: string;
}
