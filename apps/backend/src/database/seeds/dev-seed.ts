/* eslint-disable no-console -- the seed is a CLI script; stdout IS its UX. */

/**
 * `dev-seed.ts` — idempotent development seed (openspec tasks.md 12.4).
 *
 * Creates a realistic Module 1 fixture so the freshly-migrated database
 * can be exercised end-to-end (curl, Postman, frontend dev) without any
 * manual signup/role-assignment dance:
 *
 *   Organization
 *     id      : auto-generated UUID (printed on stdout)
 *     name    : "Cabinet Konan & Associés"
 *     slug    : "cabinet-konan-et-associes"
 *     type    : firm
 *
 *   Users — all share password `DemoDemo2026!`
 *     admin@erp-demo.ci    → role: admin            (org creator)
 *     expert@erp-demo.ci   → role: expert_comptable
 *     mission@erp-demo.ci  → role: chef_mission
 *     compta@erp-demo.ci   → role: comptable
 *     audit@erp-demo.ci    → role: auditeur
 *     client@erp-demo.ci   → role: client_readonly
 *
 * Re-runs are no-ops: the script checks for the admin user up front and
 * exits cleanly with a "seed already present" message. To re-seed from
 * scratch, drop & re-create the database (or run `migration:revert`
 * down to 0001 and `migration:run` back up).
 *
 * NOTE: not safe to run against production — the script makes no
 * NODE_ENV assertion (some staging-like environments share the dev seed
 * by design). Add `if (env.NODE_ENV === 'production') throw` at the
 * boundary if a team adopts this convention.
 *
 * Usage:
 *   pnpm --filter backend seed:dev
 */

import 'reflect-metadata';

import * as argon2 from 'argon2';

import { PASSWORD_HASH_OPTIONS } from '../../modules/auth/config/password.config';
import { MfaConfigEntity } from '../../modules/auth/entities/mfa-config.entity';
import { RefreshTokenEntity } from '../../modules/auth/entities/refresh-token.entity';
import { UserEntity } from '../../modules/auth/entities/user.entity';
import { OrganizationEntity } from '../../modules/organizations/entities/organization.entity';
import { MembershipEntity } from '../../modules/rbac/entities/membership.entity';
import { RoleEntity } from '../../modules/rbac/entities/role.entity';
import { AppDataSource } from '../data-source';

const DEMO_PASSWORD = 'DemoDemo2026!';
const DEMO_ORG_NAME = 'Cabinet Konan & Associés';
const DEMO_ORG_SLUG = 'cabinet-konan-et-associes';
const DEMO_ORG_TYPE = 'firm';

interface SeedMember {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly roleCode: string;
}

const MEMBERS: ReadonlyArray<SeedMember> = [
  { email: 'admin@erp-demo.ci', firstName: 'Adèle', lastName: 'Admin', roleCode: 'admin' },
  {
    email: 'expert@erp-demo.ci',
    firstName: 'Émile',
    lastName: 'Expert',
    roleCode: 'expert_comptable',
  },
  {
    email: 'mission@erp-demo.ci',
    firstName: 'Mira',
    lastName: 'Mission',
    roleCode: 'chef_mission',
  },
  { email: 'compta@erp-demo.ci', firstName: 'Cyrille', lastName: 'Compta', roleCode: 'comptable' },
  { email: 'audit@erp-demo.ci', firstName: 'Audrey', lastName: 'Audit', roleCode: 'auditeur' },
  {
    email: 'client@erp-demo.ci',
    firstName: 'Clément',
    lastName: 'Client',
    roleCode: 'client_readonly',
  },
];

async function main(): Promise<void> {
  console.log('[seed] connecting to', maskedDsn());
  await AppDataSource.initialize();

  try {
    await AppDataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const orgs = manager.getRepository(OrganizationEntity);
      const roles = manager.getRepository(RoleEntity);
      const memberships = manager.getRepository(MembershipEntity);

      // Idempotency gate: the admin user is the sentinel — if present,
      // the seed already ran and we leave everything alone.
      const existingAdmin = await users.findOne({ where: { email: MEMBERS[0].email } });
      if (existingAdmin !== null) {
        console.log(`[seed] '${MEMBERS[0].email}' already present — nothing to do.`);
        return;
      }

      const rolesByCode = new Map<string, RoleEntity>();
      for (const m of MEMBERS) {
        const role = await roles.findOne({ where: { code: m.roleCode } });
        if (role === null) {
          throw new Error(
            `[seed] role '${m.roleCode}' not found in the catalog — has migration 0003 run?`,
          );
        }
        rolesByCode.set(m.roleCode, role);
      }

      const org = await orgs.save(
        orgs.create({ name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG, type: DEMO_ORG_TYPE }),
      );
      console.log(`[seed] organization created: id=${org.id} slug=${org.slug}`);

      const passwordHash = await argon2.hash(DEMO_PASSWORD, PASSWORD_HASH_OPTIONS);

      for (const m of MEMBERS) {
        const user = await users.save(
          users.create({
            email: m.email,
            passwordHash,
            firstName: m.firstName,
            lastName: m.lastName,
            isActive: true,
          }),
        );
        await memberships.save(
          memberships.create({
            userId: user.id,
            organizationId: org.id,
            roleId: rolesByCode.get(m.roleCode)!.id,
            status: 'active',
          }),
        );
        console.log(`[seed] user+membership: ${m.email} → ${m.roleCode}`);
      }

      console.log('');
      console.log('[seed] ✓ done.');
      console.log('[seed] demo credentials:');
      console.log(`[seed]   password : ${DEMO_PASSWORD}`);
      for (const m of MEMBERS) {
        console.log(`[seed]   ${m.email.padEnd(24)} role=${m.roleCode}`);
      }
    });
  } finally {
    await AppDataSource.destroy();
  }
}

/**
 * Print the DSN with credentials redacted so the seed log never leaks
 * the Supabase / local Postgres password.
 */
function maskedDsn(): string {
  const dsn = process.env['DATABASE_URL'] ?? '<DATABASE_URL not set>';
  return dsn.replace(/(:[^:@]+)@/, ':***@');
}

// Suppress the un-used type-only imports warning: TypeORM relies on
// `MfaConfigEntity` / `RefreshTokenEntity` being part of the same DataSource
// metadata graph as the entities we directly write to. Keeping them imported
// here (even though we never instantiate them) guarantees the metadata is
// loaded when the script runs in isolation.
void MfaConfigEntity;
void RefreshTokenEntity;

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[seed] failed:', message);
  process.exitCode = 1;
});
