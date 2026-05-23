import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /auth/mfa/verify-challenge` body — exchanges the short-lived
 * `mfa_challenge` JWT (issued by `POST /auth/login` when the account has
 * MFA enabled) plus a one-time code for a full access + refresh pair.
 */
export class MfaVerifyChallengeDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  mfaChallengeToken!: string;

  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9-]+$/u, {
    message: 'code must be a 6-digit TOTP or a XXXXX-XXXXX backup code',
  })
  code!: string;
}
