import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import { LoginDto } from '../dto/login.dto';
import { MfaCodeDto } from '../dto/mfa-code.dto';
import { MfaVerifyChallengeDto } from '../dto/mfa-verify-challenge.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { SelectOrganizationDto } from '../dto/select-organization.dto';
import { SignupDto } from '../dto/signup.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import {
  AuthService,
  type LoginResult,
  type RefreshResult,
  type SelectOrganizationResult,
  type SignupResult,
} from '../services/auth.service';
import { MfaService, type MfaActivationResult, type MfaSetupResult } from '../services/mfa.service';
import { buildAuthRequestContext } from './request-context.helper';

/**
 * `AuthController` (BE-AUTH-01..05) — MVP authentication surface.
 *
 *   - `POST /auth/signup`  (BE-AUTH-01) — public, 201, creates a user.
 *   - `POST /auth/login`   (BE-AUTH-02) — public, 200, returns either a
 *     token pair (no MFA) or an `mfa_required: true` envelope with a
 *     5-min `mfaChallengeToken`.
 *   - `POST /auth/refresh` (BE-AUTH-04) — public, 200, rotates the
 *     refresh token (reuse detection + family revoke handled by
 *     `RefreshTokenService.rotate`).
 *   - `POST /auth/logout`  (BE-AUTH-05) — authenticated, 204, revokes
 *     the presented refresh token and appends `auth.logout` to the
 *     journal.
 *
 * The success envelope is added by `ResponseEnvelopeInterceptor`
 * (BE-BOOT-07); failures are reshaped by `AllExceptionsFilter`
 * (BE-BOOT-06). This controller therefore returns RAW payloads.
 *
 * `/mfa/setup` / `/mfa/verify` / `/mfa/disable` are gated by
 * `JwtAuthGuard` — they manage MFA enrollment for the authenticated
 * user. `/mfa/verify-challenge` is `@Public` because it is the second
 * leg of the login flow (the caller holds the `mfa_challenge` JWT
 * issued by `/auth/login`, not a regular access token).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Post('signup')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() body: SignupDto, @Req() req: Request): Promise<SignupResult> {
    return this.auth.signup(
      {
        email: body.email,
        password: body.password,
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      },
      buildAuthRequestContext(req),
    );
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto, @Req() req: Request): Promise<LoginResult> {
    return this.auth.login(
      { email: body.email, password: body.password },
      buildAuthRequestContext(req),
    );
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshTokenDto, @Req() req: Request): Promise<RefreshResult> {
    return this.auth.refresh(body.refreshToken, buildAuthRequestContext(req));
  }

  /**
   * `POST /auth/select-organization` is gated by `JwtAuthGuard`:
   * the caller must already be authenticated, just not yet tenant-scoped.
   * The endpoint upgrades the session by re-signing the access token with
   * `org_id` + `role` claims; from there on every tenant-scoped route can
   * trust the JWT alone.
   */
  @Post('select-organization')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async selectOrganization(
    @CurrentUser('id') userId: string,
    @Body() body: SelectOrganizationDto,
    @Req() req: Request,
  ): Promise<SelectOrganizationResult> {
    return await this.auth.selectOrganization(
      userId,
      body.organizationId,
      buildAuthRequestContext(req),
    );
  }

  /**
   * `POST /auth/mfa/setup` — initiates TOTP enrollment for the caller.
   * Returns the plaintext secret (one-time) and the `otpauth://` URI
   * suitable for a QR code. Idempotent on re-call before activation.
   */
  @Post('mfa/setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async mfaSetup(@CurrentUser('id') userId: string): Promise<MfaSetupResult> {
    return await this.mfa.setup(userId);
  }

  /**
   * `POST /auth/mfa/verify` — confirms enrollment with a fresh TOTP code.
   * On success: flips `enabled=true`, returns 10 backup codes ONCE.
   */
  @Post('mfa/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async mfaVerify(
    @CurrentUser('id') userId: string,
    @Body() body: MfaCodeDto,
    @Req() req: Request,
  ): Promise<MfaActivationResult> {
    return await this.mfa.activate(userId, { code: body.code }, buildAuthRequestContext(req));
  }

  /**
   * `POST /auth/mfa/disable` — turns MFA off. The current spec accepts
   * the call without a TOTP code (the user is already authenticated via
   * JwtAuthGuard); a future hardening pass may require a fresh code to
   * defend against a stolen access token.
   */
  @Post('mfa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async mfaDisable(@CurrentUser('id') userId: string, @Req() req: Request): Promise<void> {
    await this.mfa.disable(userId, buildAuthRequestContext(req));
  }

  /**
   * `POST /auth/mfa/verify-challenge` is `@Public` because the caller
   * holds the short-lived `mfa_challenge` JWT (not a regular access
   * token). Exchanging it + a valid TOTP / backup code mints a full
   * access + refresh pair with `mfa_verified = true`.
   */
  @Post('mfa/verify-challenge')
  @Public()
  @HttpCode(HttpStatus.OK)
  async mfaVerifyChallenge(
    @Body() body: MfaVerifyChallengeDto,
    @Req() req: Request,
  ): Promise<Exclude<LoginResult, { mfa_required: true }>> {
    return await this.auth.completeMfaLogin(
      body.mfaChallengeToken,
      body.code,
      buildAuthRequestContext(req),
    );
  }

  /**
   * `POST /auth/logout` is gated by `JwtAuthGuard`: the spec calls for an
   * authenticated user. The refresh token in the body is the one being
   * revoked; the access token in the `Authorization` header proves the
   * caller is the legitimate owner of the session.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: RefreshTokenDto, @Req() req: Request): Promise<void> {
    await this.auth.logout(body.refreshToken, buildAuthRequestContext(req));
  }
}
