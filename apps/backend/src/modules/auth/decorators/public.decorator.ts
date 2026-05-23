import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * `@Public()` — opts a handler (or controller class) out of `JwtAuthGuard`
 * (BE-RBAC-01). Designed for endpoints that MUST stay unauthenticated:
 *
 *   - `/health/db` and any future infrastructure probes,
 *   - `POST /auth/signup`, `/auth/login`, `/auth/refresh`,
 *   - `POST /auth/invitations/accept` (token in the URL, no Bearer yet).
 *
 * Implementation is a thin reflector flag read via
 * `Reflector.getAllAndOverride()`; class-level annotation propagates to
 * every handler unless overridden at the method level (Nest semantics).
 *
 * Note: `JwtAuthGuard` is opt-in at the route level for now. Once an
 * `APP_GUARD` global registration lands, `@Public()` becomes the only
 * sanctioned way to expose an unauthenticated endpoint.
 */
export const IS_PUBLIC_METADATA_KEY = 'auth:is-public';

export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_METADATA_KEY, true);
