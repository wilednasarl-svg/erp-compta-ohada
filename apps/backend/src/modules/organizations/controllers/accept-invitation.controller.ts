import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { Public } from '../../auth/decorators/public.decorator';
import { AcceptInvitationDto } from '../dto/accept-invitation.dto';
import { type AcceptInvitationResult, InvitationsService } from '../services/invitations.service';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';

/**
 * `AcceptInvitationController` (BE-INV-02) — public endpoint at
 * `POST /auth/invitations/accept`. The invitee posts the token (sent by
 * email) plus, when the email is not yet known to the platform, the
 * signup fields. `@Public()` opts out of `JwtAuthGuard` because the
 * caller is by definition not yet authenticated on the platform: the
 * token is the proof of consent (an admin sent it to that email).
 *
 * The HTTP status switches between 200 (existing user, membership added)
 * and 201 (new user, signup + membership added) based on
 * `AcceptInvitationResult.userCreated`. We use the raw `Response` for
 * that conditional status because `@HttpCode` is a compile-time
 * decorator and can't react to the payload.
 *
 * Rationale for living in `OrganizationsModule`: the controller is a
 * thin façade over `InvitationsService` which itself owns the
 * `invitations` table. Putting it here keeps the spec route prefix
 * (`/auth/...`) decoupled from module ownership.
 */
@Controller('auth/invitations')
export class AcceptInvitationController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('accept')
  @Public()
  @HttpCode(HttpStatus.OK)
  async accept(
    @Body() body: AcceptInvitationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptInvitationResult> {
    const result = await this.invitations.accept(
      {
        token: body.token,
        ...(body.password !== undefined ? { password: body.password } : {}),
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      },
      buildAuditRequestContext(req),
    );
    if (result.userCreated) {
      res.status(HttpStatus.CREATED);
    }
    return result;
  }
}
