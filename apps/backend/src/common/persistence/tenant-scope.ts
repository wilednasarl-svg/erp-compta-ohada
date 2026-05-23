/**
 * `TenantId` — branded string for organization IDs, used to make
 * tenant-scope leakage a compile-time error rather than a runtime one.
 *
 * Repositories whose underlying table carries `organization_id` (e.g.
 * `memberships`, `invitations`) accept `TenantId` (or plain `string` cast
 * via `asTenantId(...)`) as a *required* parameter on every public method.
 * A method that forgets the tenant scope cannot type-check.
 *
 * The runtime guard `assertTenantId(...)` additionally rejects empty,
 * whitespace-only, or non-string values so a programming bug (e.g.
 * `findActive(membership.organizationId)` where `organizationId` is
 * `undefined`) fails fast at the boundary instead of silently leaking
 * across tenants.
 */

declare const tenantIdBrand: unique symbol;
export type TenantId = string & { readonly [tenantIdBrand]: true };

export function asTenantId(value: string): TenantId {
  assertTenantId(value);
  return value;
}

export function assertTenantId(value: unknown): asserts value is TenantId {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      'Tenant scope violation: a non-empty organizationId is required for this repository call.',
    );
  }
}
