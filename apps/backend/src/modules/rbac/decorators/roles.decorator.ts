import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * `@Roles(...codes)` — restricts a handler to a small set of role codes
 * (matched against `roles.code`, e.g. `'admin'`, `'expert_comptable'`).
 *
 * Reserved for endpoints whose authorization is naturally expressed as
 * "one of these roles" rather than "this permission code". Most routes
 * should prefer `@RequirePermission(code)` (BE-RBAC-04) so the
 * `role × permission` matrix stays the single source of truth. Use cases
 * for this decorator: admin-only management endpoints (role assignment,
 * organization rename) where the policy is intentionally role-shaped.
 *
 * No annotation → `RolesGuard` allows: this decorator is opt-in, unlike
 * `@RequirePermission` which is deny-by-default. Composing both guards
 * therefore keeps role-based exemptions and permission-based deny lists
 * orthogonal.
 */
export const ROLES_METADATA_KEY = 'rbac:roles';

export const Roles = (...codes: ReadonlyArray<string>): CustomDecorator<string> =>
  SetMetadata(ROLES_METADATA_KEY, codes);
