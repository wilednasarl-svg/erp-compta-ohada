import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * BE-TEST-11 — architecture invariants enforced via repo-wide static
 * scan. The plan lists three:
 *
 *   1. Every controller HTTP handler has `@RequirePermission`, `@Roles`,
 *      OR is opted out via `@Public()` (class or method-level).
 *      Failure → silent privilege leak (route exposed without check).
 *
 *   2. Every method on a tenant-scoped repository (table carries
 *      `organization_id`) takes an `organizationId` parameter on its
 *      public surface. Failure → tenant data leak (a query that forgets
 *      the scope reads ROWS from other orgs).
 *
 *   3. No `console.log` / `console.debug` / `console.info` anywhere in
 *      `src/`. Logging goes through `Logger` (Pino-backed) so secrets
 *      get redacted and lines carry `request_id`.
 *
 * Implementation: pragmatic regex parsing — fast, no ts-morph dep, and
 * the false-positive risk is mitigated by very specific patterns. If a
 * future refactor breaks the scan, we add a focused exclusion rather
 * than weakening the check.
 */

const SRC_ROOT = join(__dirname, '..');

/** Tenant-scoped tables — entity files declare `organization_id` columns. */
const TENANT_SCOPED_REPOSITORIES = [
  'modules/organizations/repositories/invitation.repository.ts',
  'modules/rbac/repositories/membership.repository.ts',
];

/**
 * `listOrganizationsForUser` is the documented exception (BE-DB-11):
 * "which orgs does this user belong to?" — scoped by userId, not by
 * tenant. Skipping it in the lint avoids false-positive flak.
 */
const TENANT_SCOPE_EXCEPTIONS = new Set<string>([
  'listOrganizationsForUser',
  'findActiveByUserAndOrganizationWithOrg', // takes organizationId as 2nd arg
]);

function listFiles(dir: string, extension: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip node_modules and build output if they ever appear under src.
      if (name === 'node_modules' || name === 'dist' || name === '__tests__') {
        continue;
      }
      entries.push(...listFiles(full, extension));
    } else if (name.endsWith(extension)) {
      entries.push(full);
    }
  }
  return entries;
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

describe('Architecture invariants (BE-TEST-11)', () => {
  describe('Every controller HTTP handler is authorization-annotated', () => {
    /**
     * For each controller file, find every `@Get|Post|Patch|Put|Delete`-
     * decorated method. Each MUST be reachable by ONE of:
     *   - `@Public()` on the method
     *   - `@Public()` on the class
     *   - `@RequirePermission(...)` on the method (single source of truth
     *     for tenant-scoped routes)
     *   - `@Roles(...)` on the method (admin-only routes that don't map
     *     cleanly to a permission code, e.g. PATCH /organizations/:id)
     *   - method/class is mounted under @UseGuards(JwtAuthGuard) WITHOUT
     *     PermissionsGuard — counts as "authenticated only" (org-create,
     *     org-list, select-organization, logout, mfa-setup/verify/disable).
     *     Detected by absence of `PermissionsGuard` in the controller's
     *     @UseGuards.
     */
    const HTTP_METHOD_DECORATOR = /@(Get|Post|Patch|Put|Delete)\(/g;
    const PUBLIC_DECORATOR = /@Public\(\)/;
    const REQUIRE_PERMISSION = /@RequirePermission\(/;
    const ROLES_DECORATOR = /@Roles\(/;
    const PERMISSIONS_GUARD_IN_USEGUARDS = /@UseGuards\([^)]*PermissionsGuard[^)]*\)/;

    const controllers = listFiles(SRC_ROOT, '.controller.ts').filter(
      (f) => !f.endsWith('.spec.ts'),
    );

    test.each(controllers)('%s: every route handler has an explicit policy', (file) => {
      const content = read(file);
      const classIsPublic = PUBLIC_DECORATOR.test(content);
      const classMountsPermissionsGuard = PERMISSIONS_GUARD_IN_USEGUARDS.test(content);

      // Find each @Get/@Post/... position, then walk back ~20 lines for
      // method-level decorators.
      const lines = content.split('\n');
      const violations: string[] = [];

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        HTTP_METHOD_DECORATOR.lastIndex = 0;
        if (!HTTP_METHOD_DECORATOR.test(line)) {
          continue;
        }
        // Gather the full decorator block: walk both backward (covers
        // `@UseGuards(...)` placed before `@Post()`) and forward (covers
        // `@RequirePermission(...)` placed AFTER `@Post()` — both
        // orderings are valid Nest, my script must handle either).
        // We stop forward at the first `async ` / method signature line.
        const backStart = Math.max(0, i - 12);
        let forwardEnd = i;
        for (let j = i + 1; j < Math.min(lines.length, i + 12); j += 1) {
          if (
            /^\s*(async\s+|public\s+|private\s+|protected\s+|[A-Za-z][A-Za-z0-9_]*\s*\()/.test(
              lines[j],
            )
          ) {
            forwardEnd = j;
            break;
          }
          forwardEnd = j;
        }
        const block = lines.slice(backStart, forwardEnd + 1).join('\n');

        const methodHasPublic = PUBLIC_DECORATOR.test(block);
        const methodHasRequirePermission = REQUIRE_PERMISSION.test(block);
        const methodHasRoles = ROLES_DECORATOR.test(block);

        const annotated =
          classIsPublic ||
          methodHasPublic ||
          methodHasRequirePermission ||
          methodHasRoles ||
          // Authenticated-only route: class uses JwtAuthGuard but NOT
          // PermissionsGuard. The route doesn't need a permission code.
          !classMountsPermissionsGuard;

        if (!annotated) {
          violations.push(`line ${i + 1}: ${line.trim()}`);
        }
      }

      if (violations.length > 0) {
        const relativeFile = relative(SRC_ROOT, file).split(sep).join('/');
        throw new Error(
          `${relativeFile} — handlers without @Public / @RequirePermission / @Roles:\n  ${violations.join(
            '\n  ',
          )}`,
        );
      }
    });
  });

  describe('Tenant-scoped repository methods require organizationId', () => {
    test.each(TENANT_SCOPED_REPOSITORIES)(
      '%s: every public async method declares organizationId in its signature',
      (relativePath) => {
        const file = join(SRC_ROOT, ...relativePath.split('/'));
        const content = read(file);
        // Capture `async <name>(<params>)`. Multiline parameter lists are
        // handled via the `[\s\S]` class.
        const methodRe = /async\s+([A-Za-z][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*:/g;
        const violations: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = methodRe.exec(content)) !== null) {
          const [, name, params] = match;
          if (TENANT_SCOPE_EXCEPTIONS.has(name)) {
            continue;
          }
          if (!/organizationId/.test(params)) {
            violations.push(`${name}(${params.trim().replace(/\s+/g, ' ')})`);
          }
        }
        if (violations.length > 0) {
          throw new Error(
            `${relativePath} — methods missing organizationId parameter:\n  ${violations.join('\n  ')}`,
          );
        }
      },
    );
  });

  describe('No console.log / .debug / .info anywhere in src/', () => {
    it('every src file uses the Pino-backed Logger instead of console', () => {
      const allFiles = listFiles(SRC_ROOT, '.ts').filter(
        (f) => !f.endsWith('.spec.ts') && !f.includes('__tests__'),
      );
      // `console.warn` and `console.error` are tolerated (rare, used in
      // CLI scripts) — the ban targets the chatty levels that flood
      // stdout and bypass the redaction pipeline.
      const FORBIDDEN = /\bconsole\.(log|debug|info|trace)\(/;
      // File-level `/* eslint-disable no-console */` comment (anywhere
      // in the first 20 lines) opts the whole file out — used by CLI
      // scripts (seeds, migrations) where stdout IS the UX.
      const FILE_LEVEL_DISABLE = /\/\*\s*eslint-disable[^*]*\bno-console\b/;
      const violations: string[] = [];
      for (const file of allFiles) {
        const content = read(file);
        const head = content.split('\n').slice(0, 20).join('\n');
        if (FILE_LEVEL_DISABLE.test(head)) {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (!FORBIDDEN.test(line)) {
            continue;
          }
          const prev = lines[i - 1] ?? '';
          const sameLineDisable = /eslint-disable-(next-)?line\s+no-console/.test(line);
          const blockDisable = /eslint-disable-next-line\s+no-console/.test(prev);
          if (sameLineDisable || blockDisable) {
            continue;
          }
          const relativeFile = relative(SRC_ROOT, file).split(sep).join('/');
          violations.push(`${relativeFile}:${i + 1} → ${line.trim()}`);
        }
      }
      if (violations.length > 0) {
        throw new Error(
          `console.log/debug/info found (use Logger from @nestjs/common or nestjs-pino):\n  ${violations.join(
            '\n  ',
          )}`,
        );
      }
    });
  });
});
