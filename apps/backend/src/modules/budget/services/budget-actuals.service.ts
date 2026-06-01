import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BudgetLineEntity } from '../entities/budget-line.entity';
import { BudgetActualsRepository } from '../repositories/budget-actuals.repository';
import { BudgetLineRepository } from '../repositories/budget-line.repository';
import {
  inferBudgetType,
  orientActualAmount,
} from '../lib/budget-actuals-mapping';
import { sumAmounts } from '../lib/budget-money';
import { DEFAULT_BUDGET_CURRENCY } from '../types/budget.types';

/** Résultat de synchronisation, exposé à l'UI pour le feedback. */
export interface SyncActualsResult {
  readonly fiscalYear: number;
  /** Nombre de lignes REAL (compte × mois) générées. */
  readonly linesCreated: number;
  /** Nombre de comptes distincts touchés. */
  readonly accountsCount: number;
  /** Total réalisé orienté, toutes lignes confondues (string NUMERIC). */
  readonly totalActual: string;
}

/**
 * Alimente le scénario `REAL` du budget à partir de la comptabilité.
 *
 * Idempotent par exercice : chaque synchronisation purge les lignes `REAL`
 * existantes de l'exercice puis réinsère l'agrégat courant des écritures
 * validées. Aucune saisie manuelle du réalisé n'est donc nécessaire — le
 * calcul d'écart budget/réalisé (inchangé) lit ces lignes comme avant.
 *
 * Seuls les comptes pilotables (classes 2/5/6/7 → CAPEX/TRESO/OPEX) génèrent
 * une ligne ; les soldes nets nuls sont ignorés.
 */
@Injectable()
export class BudgetActualsService {
  private readonly logger = new Logger(BudgetActualsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly actualsRepo: BudgetActualsRepository,
    private readonly lineRepo: BudgetLineRepository,
  ) {}

  async syncActuals(
    organizationId: TenantId,
    fiscalYear: number,
    userId?: string | null,
  ): Promise<SyncActualsResult> {
    assertTenantId(organizationId);

    const aggregates = await this.actualsRepo.aggregateActualsByAccountMonth(
      organizationId,
      fiscalYear,
    );

    const accounts = new Set<string>();
    const amounts: string[] = [];
    let linesCreated = 0;

    await this.dataSource.transaction(async (manager) => {
      // Purge idempotente : on repart d'un réalisé propre pour l'exercice.
      await manager.delete(BudgetLineEntity, {
        organizationId,
        fiscalYear,
        scenario: 'REAL',
      });

      for (const row of aggregates) {
        const budgetType = inferBudgetType(row.accountClass);
        if (budgetType === null) continue; // compte de bilan hors pilotage budget

        const amount = orientActualAmount(
          row.totalDebit,
          row.totalCredit,
          row.normalBalance,
          row.isOpposing,
        );
        if (amount === '0.00') continue; // solde net nul : pas de ligne vide

        await this.lineRepo.create(
          {
            organizationId,
            fiscalYear,
            periodMonth: row.month,
            budgetType,
            scenario: 'REAL',
            accountCode: row.accountCode,
            accountLabel: row.accountLabel,
            amount,
            currency: DEFAULT_BUDGET_CURRENCY,
            exchangeRate: '1',
            amountBase: amount, // écritures déjà en devise de base (XOF)
            status: 'verrouille', // réalisé figé : non éditable à la main
            createdById: userId ?? null,
          },
          manager,
        );

        accounts.add(row.accountCode);
        amounts.push(amount);
        linesCreated += 1;
      }
    });

    const result: SyncActualsResult = {
      fiscalYear,
      linesCreated,
      accountsCount: accounts.size,
      totalActual: amounts.length > 0 ? sumAmounts(amounts) : '0.00',
    };

    this.logger.log(
      `Réalisé synchronisé (org=${organizationId}, exercice=${fiscalYear}) : ` +
        `${result.linesCreated} lignes / ${result.accountsCount} comptes.`,
    );

    return result;
  }
}
