import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { CurrentUserContext, RequestContext } from '../../../common/types/request-context';

/**
 * `@CurrentUser()` — controller param decorator returning the authenticated
 * principal populated by `JwtAuthGuard` (BE-RBAC-01) on `req.context.currentUser`.
 *
 * The decorator returns `undefined` when no user is bound (e.g. routes
 * marked `@Public()`); call sites that REQUIRE a user must compose with
 * `JwtAuthGuard` upstream and treat `undefined` as a programmer error
 * rather than a normal control-flow case.
 *
 * Optional sub-property accessor:
 *
 *   `@CurrentUser('id') userId: string`
 *
 * picks a single field from `CurrentUserContext` without exposing the
 * whole object — convenient for controllers that only need the user id.
 */
export const CurrentUser = createParamDecorator(
  (
    field: keyof CurrentUserContext | undefined,
    ctx: ExecutionContext,
  ): CurrentUserContext | CurrentUserContext[keyof CurrentUserContext] | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { context?: RequestContext }>();
    const current = req.context?.currentUser;
    if (current === undefined) {
      return undefined;
    }
    return field === undefined ? current : current[field];
  },
);
