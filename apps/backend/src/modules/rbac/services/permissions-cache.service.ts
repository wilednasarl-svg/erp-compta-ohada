import { Injectable, Logger } from '@nestjs/common';

import { RolePermissionRepository } from '../repositories/role-permission.repository';

/**
 * `PermissionsCacheService` (BE-RBAC-09) — in-memory cache of the
 * `role × permission` matrix.
 *
 * The matrix is small (13 permission codes × 6 seeded roles = 78 rows
 * tops) and changes rarely (only via a future admin endpoint that
 * touches `role_permissions`). Caching per-role permission sets in a
 * `Map<roleId, Set<code>>` removes one Postgres round-trip from
 * `PermissionsGuard.canActivate` on the hot path of every authenticated
 * tenant-scoped request.
 *
 * Policy:
 *   - Lazy population: first lookup for a roleId triggers
 *     `RolePermissionRepository.listPermissionCodesForRole(roleId)`;
 *     subsequent lookups hit the in-memory `Set`.
 *   - Manual invalidation: `invalidateRole(roleId)` and
 *     `invalidateAll()` are public so a future role-matrix mutation
 *     endpoint (or a debug "reload RBAC" admin button) can flush.
 *   - No TTL: the seeded matrix is immutable for the Module 1 lifetime,
 *     and Module 2+ mutations will explicitly invalidate. A blind TTL
 *     would only waste memory and reintroduce the round-trip we just
 *     removed.
 *   - Process-local: the cache lives in the Node process. A horizontally-
 *     scaled deployment (multiple Nest instances) needs a shared
 *     invalidation channel (Redis pub/sub, NATS) when matrix writes
 *     land — out of scope for Module 1. Pre-write, instances will see
 *     drift for at most one request lifetime.
 *
 * Concurrent first-hit safety: two requests for the same fresh roleId
 * can race the populate, both calling the repo. The second `set()` is
 * a no-op overwrite with the same data, so the only cost is a redundant
 * query. We deliberately do NOT lock — the alternative (a Promise-
 * tracking `inFlight` map) is more complex than the redundant fetch
 * costs at our scale.
 */
@Injectable()
export class PermissionsCacheService {
  private readonly logger = new Logger(PermissionsCacheService.name);
  private readonly cache = new Map<string, ReadonlySet<string>>();

  constructor(private readonly rolePermissions: RolePermissionRepository) {}

  async roleHasPermission(roleId: string, permissionCode: string): Promise<boolean> {
    const set = await this.getOrLoad(roleId);
    return set.has(permissionCode);
  }

  async getPermissionsForRole(roleId: string): Promise<ReadonlySet<string>> {
    return this.getOrLoad(roleId);
  }

  invalidateRole(roleId: string): void {
    if (this.cache.delete(roleId)) {
      this.logger.log(`invalidated role=${roleId}`);
    }
  }

  invalidateAll(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.log(`invalidated all (${size} role entries cleared)`);
  }

  /** Test-only inspection. NOT exported via `index.ts`. */
  size(): number {
    return this.cache.size;
  }

  private async getOrLoad(roleId: string): Promise<ReadonlySet<string>> {
    const cached = this.cache.get(roleId);
    if (cached !== undefined) {
      return cached;
    }
    const codes = await this.rolePermissions.listPermissionCodesForRole(roleId);
    const set = new Set(codes);
    this.cache.set(roleId, set);
    return set;
  }
}
