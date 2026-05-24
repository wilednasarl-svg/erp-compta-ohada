import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { AuditTrailService } from '../../audit/services/audit-trail.service';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { OrganizationAccountEntity } from '../entities/organization-account.entity';
import { OrganizationAccountRepository } from '../repositories/organization-account.repository';
import type { AccountType, AccountingSystem, NormalBalance } from '../types/accounting-system';

/**
 * Public projection of an organization account row. Stable wire-shape
 * decoupled from the entity so reshaping the column layout doesn't
 * break the controllers / clients.
 */
export interface AccountView {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly class: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly accountType: AccountType;
  readonly normalBalance: NormalBalance;
  readonly parentId: string | null;
  readonly isCustom: boolean;
  readonly isActive: boolean;
}

/**
 * Code format: 2–10 digits. The 1-digit class roots only exist in the
 * REFERENCE chart; an organization's chart cannot host them as
 * editable rows (the clone strips them) so the public surface enforces
 * the stricter 2-char minimum.
 */
const CODE_REGEX = /^\d{2,10}$/;

/**
 * `ChartOfAccountsService` (BE-PC-06) — orchestrates the per-org
 * chart of accounts: initial clone from the SYSCOHADA reference,
 * reads, custom-account creation, label/active edits, and deletion of
 * custom leaves.
 *
 * Invariants enforced here (spec: `module-2-plan-comptable/specs/accounting-plan/spec.md`):
 *
 *   - tenant isolation: every public method takes `organizationId` and
 *     all repository calls scope on it (`TenantGuard` upstream blocks
 *     cross-tenant tokens; this service is the second line);
 *   - code immutability: `code`, `class`, `normalBalance`, `parentId`
 *     and `referenceAccountId` are NEVER updated post-creation;
 *   - prefix hierarchy: a custom code MUST begin with its parent's
 *     code and be strictly longer (validated before the INSERT);
 *   - parent promotion: a POSTING parent that gains its first child
 *     is promoted to TITLE in the same transaction;
 *   - deletion guard: only custom (`reference_account_id IS NULL`)
 *     LEAF accounts may be deleted; everything else surfaces
 *     `CHART_ACCOUNT_NOT_DELETABLE` (409).
 *
 * Audit events are appended through `AuditTrailService` (Module 7
 * vague 1 — BE-AUDIT-12) with swallow-and-warn semantics: a failed
 * journal write must not break the comptable's workflow. Every emit
 * carries `module='chart_of_accounts'`, an `entity_type` /
 * `entity_id` pair pointing at the touched account, and a `before`
 * / `after` JSONB pair on update paths so the audit-log view can
 * reconstruct the diff without joining the live row.
 */
@Injectable()
export class ChartOfAccountsService {
  private static readonly MODULE = 'chart_of_accounts' as const;
  private static readonly ENTITY_TYPE = 'organization_account' as const;

  constructor(
    private readonly accounts: OrganizationAccountRepository,
    private readonly audit: AuditTrailService,
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // Clone — BE-PC-06.1
  // ─────────────────────────────────────────────────────────────────

  /**
   * Clone every reference account applicable to `system` into
   * `organization_chart_accounts` for `organizationId`. Materialises
   * `parent_id` via prefix lookup in a second pass (single SQL
   * UPDATE — no per-row round-trip).
   *
   * The clone is idempotent: rows whose `(organization_id, code)`
   * pair already exists are skipped via `ON CONFLICT DO NOTHING`.
   * Returns `{ added, skipped }` so the `/import` endpoint can
   * report what actually happened.
   *
   * Must run inside an outer transaction (`OrganizationsService.create`
   * wraps org insert + accounting config insert + this call). Pass the
   * outer `EntityManager` via `txManager` so the work joins that
   * transaction; if none is given, a self-managed transaction is used
   * (e.g. the `/import` endpoint for the degraded recovery path).
   */
  async cloneReferenceIntoOrganization(
    organizationId: string,
    system: AccountingSystem,
    txManager?: EntityManager,
  ): Promise<{ added: number; skipped: number }> {
    const run = async (manager: EntityManager): Promise<{ added: number; skipped: number }> => {
      // Pull the reference rows applicable to the chosen system. We
      // skip 1-digit class roots: those are structural markers in the
      // reference catalogue but would clutter every org's chart with
      // 9 non-actionable rows. The tree is rooted at 2-digit codes.
      const refRows = await manager
        .getRepository('reference_chart_accounts')
        .createQueryBuilder('r')
        .where(':system = ANY(r.applicable_systems)', { system })
        .andWhere('length(r.code) >= 2')
        .orderBy('r.code', 'ASC')
        .getMany();

      if (refRows.length === 0) {
        return { added: 0, skipped: 0 };
      }

      // Pass 1 — insert without parent_id (resolved in pass 2). We use
      // a single multi-row INSERT … ON CONFLICT DO NOTHING so the
      // call is one DB round-trip and partial replays are safe.
      const placeholders: string[] = [];
      const values: unknown[] = [];
      refRows.forEach((row: Record<string, unknown>, i: number) => {
        const base = i * 8;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, ` +
            `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
        );
        // `.getMany()` returns entity-mapped rows: TypeORM converts the
        // DB snake_case columns (`account_type`, `normal_balance`) to
        // the entity's camelCase properties (`accountType`,
        // `normalBalance`). Reading the snake_case names returns
        // undefined → null in the INSERT → "null value in column
        // account_type violates not-null constraint". Bug that
        // 100 % blocked org creation in prod (no spec covered this
        // method end-to-end).
        values.push(
          organizationId,
          row['code'],
          row['label'],
          row['class'],
          row['accountType'],
          row['normalBalance'],
          row['id'], // reference_account_id
          true, // is_active
        );
      });

      const insertResult: Array<unknown> = await manager.query(
        `INSERT INTO "organization_chart_accounts"
           ("organization_id", "code", "label", "class",
            "account_type", "normal_balance", "reference_account_id", "is_active")
         VALUES ${placeholders.join(', ')}
         ON CONFLICT ("organization_id", "code") DO NOTHING
         RETURNING "id"`,
        values,
      );
      const added = insertResult.length;
      const skipped = refRows.length - added;

      // Pass 2 — wire up parent_id. For every row whose code length
      // is ≥ 3, the parent is the org's row with the longest strict
      // prefix that also exists. A single correlated UPDATE handles
      // all rows in one pass; only rows still missing parent_id are
      // touched (so a re-run does the right thing on the
      // newly-inserted subset).
      await manager.query(
        `UPDATE "organization_chart_accounts" AS child
         SET "parent_id" = parent."id"
         FROM "organization_chart_accounts" AS parent
         WHERE child.organization_id = $1
           AND parent.organization_id = $1
           AND child.parent_id IS NULL
           AND length(child.code) > length(parent.code)
           AND child.code LIKE parent.code || '%'
           AND parent.code = (
             SELECT p2.code
             FROM "organization_chart_accounts" AS p2
             WHERE p2.organization_id = $1
               AND length(p2.code) < length(child.code)
               AND child.code LIKE p2.code || '%'
             ORDER BY length(p2.code) DESC
             LIMIT 1
           )`,
        [organizationId],
      );

      return { added, skipped };
    };

    if (txManager !== undefined) {
      return run(txManager);
    }
    return this.dataSource.transaction(run);
  }

  // ─────────────────────────────────────────────────────────────────
  // Reads — BE-PC-06.2 / 6.3
  // ─────────────────────────────────────────────────────────────────

  async listForOrganization(
    organizationId: string,
    options: { activeOnly?: boolean; classFilter?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 } = {},
  ): Promise<ReadonlyArray<AccountView>> {
    const rows = await this.accounts.listByOrganization(organizationId, options);
    return rows.map((r) => this.toView(r));
  }

  async getAccount(organizationId: string, accountId: string): Promise<AccountView> {
    const row = await this.accounts.findById(accountId, organizationId);
    if (row === null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: 'Account not found in this organization chart',
      });
    }
    return this.toView(row);
  }

  // ─────────────────────────────────────────────────────────────────
  // Custom account creation — BE-PC-06.4
  // ─────────────────────────────────────────────────────────────────

  async createCustomAccount(
    organizationId: string,
    input: { parentCode: string; code: string; label: string },
    actorUserId: string,
    context: AuditContext,
  ): Promise<AccountView> {
    const { parentCode, code, label } = input;

    if (!CODE_REGEX.test(code)) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_INVALID_CODE, {
        message: 'Code must be 2 to 10 digits',
        details: { code },
      });
    }

    if (code.length <= parentCode.length || !code.startsWith(parentCode)) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_INVALID_PARENT, {
        message: `Code must start with parent code (${parentCode}) and be strictly longer`,
        details: { code, parentCode },
      });
    }

    const parent = await this.accounts.findByCode(parentCode, organizationId);
    if (parent === null || !parent.isActive) {
      // Inactive parents cannot host new children — they're on a
      // deactivation path and must be reactivated explicitly first.
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_INVALID_PARENT, {
        message: `Parent account '${parentCode}' is missing or inactive`,
        details: { parentCode },
      });
    }

    const existing = await this.accounts.findByCode(code, organizationId);
    if (existing !== null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_CODE_TAKEN, {
        message: 'Code already used in this organization',
        details: { code },
      });
    }

    // The new account inherits its parent's class + sens normal (these
    // are normed by SYSCOHADA per sub-class, not freely chosen).
    const created = await this.accounts.create({
      organizationId,
      code,
      label,
      class: parent.class,
      accountType: 'POSTING',
      normalBalance: parent.normalBalance,
      parentId: parent.id,
      referenceAccountId: null,
      isActive: true,
    });

    // Parent promotion: a POSTING that just acquired its first child
    // must become a TITLE — only leaves can be posted to (the
    // invariant Module 3 will enforce on écritures). Done unconditionally
    // when parent was POSTING; idempotent if it was already TITLE.
    if (parent.accountType === 'POSTING') {
      await this.accounts.setAccountType(parent.id, organizationId, 'TITLE');
      await this.audit.record({
        module: ChartOfAccountsService.MODULE,
        action: 'account_updated',
        entityType: ChartOfAccountsService.ENTITY_TYPE,
        entityId: parent.id,
        before: { accountType: 'POSTING' },
        after: { accountType: 'TITLE' },
        metadata: {
          code: parent.code,
          reason: 'first_child_added',
        },
        ctx: { ...context, userId: actorUserId, organizationId },
        legacyEventType: 'chart_of_accounts.account_updated',
      });
    }

    await this.audit.record({
      module: ChartOfAccountsService.MODULE,
      action: 'account_created',
      entityType: ChartOfAccountsService.ENTITY_TYPE,
      entityId: created.id,
      after: {
        code: created.code,
        label: created.label,
        parentCode: parent.code,
      },
      metadata: {
        code: created.code,
        parentCode: parent.code,
      },
      ctx: { ...context, userId: actorUserId, organizationId },
      legacyEventType: 'chart_of_accounts.account_created',
    });

    return this.toView(created);
  }

  // ─────────────────────────────────────────────────────────────────
  // Update label / isActive — BE-PC-06.5
  // ─────────────────────────────────────────────────────────────────

  async updateAccount(
    organizationId: string,
    accountId: string,
    patch: { label?: string; isActive?: boolean; code?: string },
    actorUserId: string,
    context: AuditContext,
  ): Promise<AccountView> {
    // Surface a clean 422 if the caller sneaks `code` (or any other
    // immutable field) into the body — class-validator strips unknown
    // properties at the controller, but `code` is *known* and would
    // otherwise be silently ignored, which is confusing.
    if (patch.code !== undefined) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_IMMUTABLE_CODE, {
        message: "Field 'code' cannot be modified after creation",
      });
    }

    const existing = await this.accounts.findById(accountId, organizationId);
    if (existing === null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: 'Account not found in this organization chart',
      });
    }

    const labelChanged = patch.label !== undefined && patch.label !== existing.label;
    const activeChanged = patch.isActive !== undefined && patch.isActive !== existing.isActive;
    if (!labelChanged && !activeChanged) {
      // No-op — return the current view, do not write to the journal.
      return this.toView(existing);
    }

    await this.accounts.updateLabelAndActive(accountId, organizationId, {
      label: labelChanged ? patch.label : undefined,
      isActive: activeChanged ? patch.isActive : undefined,
    });

    if (activeChanged && patch.isActive === false) {
      await this.audit.record({
        module: ChartOfAccountsService.MODULE,
        action: 'account_deactivated',
        entityType: ChartOfAccountsService.ENTITY_TYPE,
        entityId: accountId,
        before: { isActive: true },
        after: { isActive: false },
        metadata: { code: existing.code },
        ctx: { ...context, userId: actorUserId, organizationId },
        legacyEventType: 'chart_of_accounts.account_deactivated',
      });
    } else {
      // Only the fields that actually changed go into before/after —
      // keeps the JSONB payload small and the audit view readable.
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (labelChanged) {
        before.label = existing.label;
        after.label = patch.label;
      }
      if (activeChanged) {
        before.isActive = existing.isActive;
        after.isActive = patch.isActive;
      }
      await this.audit.record({
        module: ChartOfAccountsService.MODULE,
        action: 'account_updated',
        entityType: ChartOfAccountsService.ENTITY_TYPE,
        entityId: accountId,
        before,
        after,
        metadata: { code: existing.code },
        ctx: { ...context, userId: actorUserId, organizationId },
        legacyEventType: 'chart_of_accounts.account_updated',
      });
    }

    const refreshed = await this.accounts.findById(accountId, organizationId);
    // refreshed cannot be null: we just updated it, and tenant scope
    // hasn't changed. Defensive null-check to satisfy the compiler;
    // a real null here would be a true data-integrity bug worth
    // raising rather than silently swallowing.
    if (refreshed === null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: 'Account vanished mid-update',
      });
    }
    return this.toView(refreshed);
  }

  // ─────────────────────────────────────────────────────────────────
  // Deletion — BE-PC-06.6
  // ─────────────────────────────────────────────────────────────────

  async deleteAccount(
    organizationId: string,
    accountId: string,
    actorUserId: string,
    context: AuditContext,
  ): Promise<void> {
    const existing = await this.accounts.findById(accountId, organizationId);
    if (existing === null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: 'Account not found in this organization chart',
      });
    }

    if (existing.referenceAccountId !== null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_DELETABLE, {
        message: 'Reference accounts cannot be deleted, only deactivated',
      });
    }

    const activeChildren = await this.accounts.countChildren(accountId, organizationId, {
      activeOnly: true,
    });
    if (activeChildren > 0) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_DELETABLE, {
        message: 'Account has active sub-accounts',
        details: { activeChildren },
      });
    }

    const affected = await this.accounts.deleteCustom(accountId, organizationId);
    if (affected === 0) {
      // Race condition: a concurrent caller deleted the row, or the
      // SQL guard (reference_account_id IS NULL) blocked us. Either
      // way the resource is gone or undeletable — 409 is honest.
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_DELETABLE, {
        message: 'Account could not be deleted',
      });
    }

    await this.audit.record({
      module: ChartOfAccountsService.MODULE,
      action: 'account_deleted',
      entityType: ChartOfAccountsService.ENTITY_TYPE,
      entityId: accountId,
      before: {
        code: existing.code,
        label: existing.label,
        isActive: existing.isActive,
      },
      after: null,
      metadata: { code: existing.code },
      ctx: { ...context, userId: actorUserId, organizationId },
      // Legacy compound code kept on `account_updated` so the
      // pre-Module-7 reader at `/organizations/:id/auth-events`
      // continues to bucket deletions next to updates — until vague 2
      // adds a dedicated `account_deleted` row to the Module 1 view.
      legacyEventType: 'chart_of_accounts.account_updated',
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Projection
  // ─────────────────────────────────────────────────────────────────

  private toView(row: OrganizationAccountEntity): AccountView {
    return {
      id: row.id,
      code: row.code,
      label: row.label,
      class: row.class,
      accountType: row.accountType,
      normalBalance: row.normalBalance,
      parentId: row.parentId,
      isCustom: row.referenceAccountId === null,
      isActive: row.isActive,
    };
  }
}
