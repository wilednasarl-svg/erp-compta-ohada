import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { type TenantId } from '../../../common/persistence/tenant-scope';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import {
  FiscalYearSnapshotEntity,
  type FiscalYearSnapshotType,
} from '../entities/fiscal-year-snapshot.entity';
import { FiscalYearSnapshotsRepository } from '../repositories/fiscal-year-snapshots.repository';
import { CashFlowService } from './cash-flow.service';
import { ReportsService } from './reports.service';

/**
 * `FiscalYearSnapshotsService` — W5.5. Fige les chiffres officiels
 * d'un exercice clôturé pour servir de base de comparaison N-1 dans
 * la liasse SYSCOHADA. Pose et récupère les snapshots du Bilan, du
 * Compte de résultat, des SIG et du TFT.
 *
 * Pourquoi snapshot et pas recalcul à la volée ? Si des écritures
 * correctives passent rétroactivement sur l'exercice clos (corrections
 * de section sociale, contrôles fiscaux, etc.), les chiffres N-1
 * recalculés divergent des chiffres officiels déposés. Le snapshot
 * fige la "vérité publique".
 *
 * Wiring controller (endpoint POST `/reports/exercises/:id/snapshot`)
 * reporté en W5.5.b — service livré standalone pour permettre les
 * tests unitaires et l'intégration dans `ReportsPackageService` sans
 * conflit de merge avec les vagues parallèles.
 */
@Injectable()
export class FiscalYearSnapshotsService {
  private readonly logger = new Logger(FiscalYearSnapshotsService.name);

  constructor(
    private readonly reports: ReportsService,
    private readonly periodRepo: AccountingPeriodRepository,
    private readonly snapshotsRepo: FiscalYearSnapshotsRepository,
    private readonly cashFlow: CashFlowService,
  ) {}

  /**
   * Pose le snapshot du type demandé pour un exercice annuel. Le
   * payload est calculé en appelant le service Reports correspondant
   * à `snapshotType` et stocké en JSONB.
   *
   * Si un snapshot actif existe pour le même (org, exercise, type),
   * il est marqué `supersededAt = now()` et un nouveau est inséré.
   *
   * @throws NotFoundException si l'exercice n'existe pas ou n'est pas
   *         annuel.
   */
  async takeSnapshot(
    organizationId: TenantId,
    exerciseId: string,
    snapshotType: FiscalYearSnapshotType,
    actorId: string | null,
  ): Promise<FiscalYearSnapshotEntity> {
    const period = await this.periodRepo.findById(exerciseId, organizationId);
    if (!period) {
      throw new NotFoundException(`Accounting period ${exerciseId} not found.`);
    }
    if (period.kind !== 'ANNUAL') {
      throw new NotFoundException(
        `Period ${exerciseId} is not an annual exercise (kind=${period.kind}).`,
      );
    }

    const payload = await this.computePayload(
      organizationId,
      period.startDate,
      period.endDate,
      snapshotType,
    );

    const snapshot = await this.snapshotsRepo.upsertActive({
      organizationId,
      exerciseId: period.id,
      snapshotType,
      payload,
      takenById: actorId,
    });

    this.logger.log(
      `Snapshot taken org=${organizationId} exercise=${exerciseId} type=${snapshotType} id=${snapshot.id}`,
    );

    return snapshot;
  }

  /**
   * Récupère le snapshot ACTIF du type demandé (NULL si jamais fixé).
   * À utiliser pour alimenter la colonne N-1 des rapports année N.
   */
  async getActive(
    organizationId: TenantId,
    exerciseId: string,
    snapshotType: FiscalYearSnapshotType,
  ): Promise<FiscalYearSnapshotEntity | null> {
    return this.snapshotsRepo.getActive(organizationId, exerciseId, snapshotType);
  }

  /**
   * Historique complet des snapshots pour audit / vue rétroactive.
   */
  async listHistory(
    organizationId: TenantId,
    exerciseId: string,
    snapshotType: FiscalYearSnapshotType,
  ): Promise<ReadonlyArray<FiscalYearSnapshotEntity>> {
    return this.snapshotsRepo.listHistory(organizationId, exerciseId, snapshotType);
  }

  /**
   * Calcule le payload d'un snapshot en déléguant au service Reports
   * approprié. Pour chaque type, on stocke le `Report` entier — la
   * structure du payload est la même que celle exposée par l'API.
   *
   * Le SIG et le TFT n'ont pas besoin de `fiscalYearStartDate`
   * supplémentaire (la période suffit). Le Bilan en revanche utilise
   * `fiscalYearStartDate = period.startDate` pour incorporer le
   * résultat net dans les capitaux propres.
   */
  private async computePayload(
    organizationId: TenantId,
    periodStart: string,
    periodEnd: string,
    snapshotType: FiscalYearSnapshotType,
  ): Promise<Record<string, unknown>> {
    switch (snapshotType) {
      case 'BILAN':
        return (await this.reports.getBalanceSheet(organizationId, {
          asAtDate: periodEnd,
          fiscalYearStartDate: periodStart,
        })) as unknown as Record<string, unknown>;
      case 'PROFIT_LOSS':
        return (await this.reports.getProfitLoss(organizationId, {
          fromDate: periodStart,
          toDate: periodEnd,
        })) as unknown as Record<string, unknown>;
      case 'SIG':
        return (await this.reports.getSig(organizationId, {
          fromDate: periodStart,
          toDate: periodEnd,
        })) as unknown as Record<string, unknown>;
      case 'TFT':
        return (await this.cashFlow.getCashFlow(organizationId, {
          fromDate: periodStart,
          toDate: periodEnd,
        })) as unknown as Record<string, unknown>;
    }
  }
}
