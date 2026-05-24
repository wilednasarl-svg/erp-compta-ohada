import { Injectable } from '@nestjs/common';

import { ReferenceAccountRepository } from '../repositories/reference-account.repository';
import type { AccountType, AccountingSystem, NormalBalance } from '../types/accounting-system';

/**
 * Public projection of a reference account row. Kept DB-shape-independent
 * so the wire contract (consumed by `GET /reference-chart-of-accounts`
 * and by `ChartOfAccountsService.cloneReferenceIntoOrganization`)
 * survives entity refactors.
 */
export interface ReferenceAccountView {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly class: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly accountType: AccountType;
  readonly normalBalance: NormalBalance;
  readonly applicableSystems: ReadonlyArray<AccountingSystem>;
}

/**
 * `ReferenceChartService` (BE-PC-05) — read-only access to the OHADA
 * SYSCOHADA AUDCIF reference chart.
 *
 * The reference catalogue is global (no `organization_id`), shared by
 * every organisation, and immutable from the API: only TypeORM
 * migrations may write to `reference_chart_accounts`. This service is
 * intentionally thin — its job is to project the entity into the
 * documented public view and to be the single sanctioned entry-point
 * the controller / the clone path / the future analytics agents talk
 * to (instead of injecting the repository directly).
 */
@Injectable()
export class ReferenceChartService {
  constructor(private readonly references: ReferenceAccountRepository) {}

  async listBySystem(system: AccountingSystem): Promise<ReadonlyArray<ReferenceAccountView>> {
    const rows = await this.references.listBySystem(system);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      class: row.class,
      accountType: row.accountType,
      normalBalance: row.normalBalance,
      applicableSystems: row.applicableSystems,
    }));
  }
}
