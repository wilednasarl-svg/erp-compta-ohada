import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { CurrentOrgContext, RequestContext } from '../../../common/types/request-context';

/**
 * `@CurrentOrg()` — controller param decorator returning the tenant context
 * populated by `TenantGuard` (BE-RBAC-02) on `req.context.currentOrg`.
 *
 * Returns `undefined` when no tenant is bound (route not gated by
 * `TenantGuard`, or executed against a token that has no `org_id` claim
 * yet — e.g. immediately after `POST /auth/login`). Routes that REQUIRE a
 * tenant must compose with `TenantGuard` upstream.
 *
 * Optional sub-property accessor mirrors `@CurrentUser`:
 *
 *   `@CurrentOrg('id') orgId: string`
 *   `@CurrentOrg('role') role: string`
 */
export const CurrentOrg = createParamDecorator(
  (
    field: keyof CurrentOrgContext | undefined,
    ctx: ExecutionContext,
  ): CurrentOrgContext | CurrentOrgContext[keyof CurrentOrgContext] | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { context?: RequestContext }>();
    const current = req.context?.currentOrg;
    if (current === undefined) {
      return undefined;
    }
    return field === undefined ? current : current[field];
  },
);
