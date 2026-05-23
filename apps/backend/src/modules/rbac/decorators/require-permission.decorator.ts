import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * `@RequirePermission(code)` — declares the permission code required to
 * invoke a handler. Resolved at runtime by `PermissionsGuard`
 * (BE-RBAC-04) against the `role × permission` matrix
 * (`role_permissions`).
 *
 * The guard is deny-by-default: if it is wired and no annotation is
 * present, it surfaces `RBAC_NO_POLICY_DECLARED` (403). That fail-closed
 * stance turns "I forgot to annotate this endpoint" into a loud test
 * failure rather than a silent privilege leak.
 *
 * `code` is left as plain `string` (not narrowed to a literal union) so
 * the permission catalog can grow without touching this file. The runtime
 * check still fails 403 when the code is not present in the matrix, so
 * an unknown code is denial-by-construction.
 */
export const REQUIRE_PERMISSION_METADATA_KEY = 'rbac:permission';

export const RequirePermission = (code: string): CustomDecorator<string> =>
  SetMetadata(REQUIRE_PERMISSION_METADATA_KEY, code);
