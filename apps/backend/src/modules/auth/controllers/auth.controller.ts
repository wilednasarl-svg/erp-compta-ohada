import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { SignupDto } from '../dto/signup.dto';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import {
  AuthService,
  type LoginResult,
  type RefreshResult,
  type SignupResult,
} from '../services/auth.service';
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
 * `select-organization` and `/mfa/*` are intentionally absent — they
 * depend on Memberships (BE-ORG-*) and the MFA verify flow (BE-AUTH-MFA)
 * respectively, both deferred.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
