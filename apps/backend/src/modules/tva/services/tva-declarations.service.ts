import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { TvaDeclarationEntity } from '../entities/tva-declaration.entity';
import { TvaDeclarationLineEntity } from '../entities/tva-declaration-line.entity';
import { TvaDeclarationRepository } from '../repositories/tva-declaration.repository';
import { TvaAggregationRepository } from '../repositories/tva-aggregation.repository';
import { TVA_ACCOUNT_PREFIXES } from '../types/tva.types';

export interface ComputeDeclarationInput {
  readonly periodYear: number;
  readonly periodMonth: number;
}

export interface CancelDeclarationInput {
  readonly reason?: string;
}

@Injectable()
export class TvaDeclarationsService {
  private static readonly MODULE = 'tva' as const;
  private readonly logger = new Logger(TvaDeclarationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tvaDeclarationRepo: TvaDeclarationRepository,
    private readonly tvaAggregationRepo: TvaAggregationRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async computeDeclaration(
    organizationId: TenantId,
    input: ComputeDeclarationInput,
    actorId: string,
    ctx: AuditContext,
  ): Promise<TvaDeclarationEntity> {
    assertTenantId(organizationId);

    const { periodYear, periodMonth } = input;

    // 1. Period validation
    if (periodYear < 2000 || periodYear > 2200 || periodMonth < 1 || periodMonth > 12) {
      throw new AppException(ERROR_CODES.TVA_DECLARATION_INVALID_PERIOD, {
        message: `Période invalide : year=${periodYear}, month=${periodMonth}.`,
      });
    }

    // 2. Check for existing active declaration
    const existing = await this.tvaDeclarationRepo.findActiveByPeriod(
      organizationId,
      periodYear,
      periodMonth,
    );
    if (existing) {
      throw new AppException(ERROR_CODES.TVA_DECLARATION_ALREADY_EXISTS, {
        message: `Une déclaration active existe déjà pour la période ${periodMonth}/${periodYear}.`,
      });
    }

    // 3. Compute dates for the target month
    const fromDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(periodYear, periodMonth, 0).getDate();
    const toDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // 4. Retrieve aggregations by prefix
    // Collected prefix: '443'
    // Deductible BS prefixes: '4452', '4453', '4454', '4455'
    // Deductible Immo prefix: '4451'
    const collectedPrefix = TVA_ACCOUNT_PREFIXES.collected;
    const deductibleBsPrefixes = [...TVA_ACCOUNT_PREFIXES.deductibleBs];
    const deductibleImmoPrefix = TVA_ACCOUNT_PREFIXES.deductibleImmo;

    const allPrefixes = [collectedPrefix, ...deductibleBsPrefixes, deductibleImmoPrefix];

    const aggRows = await this.tvaAggregationRepo.aggregateByPrefixes(
      organizationId,
      fromDate,
      toDate,
      allPrefixes,
    );

    // 5. Map aggregations to declaration lines and compute totals
    const lines: TvaDeclarationLineEntity[] = [];
    let tvaCollecteeTotal = 0;
    let tvaDeductibleBsTotal = 0;
    let tvaDeductibleImmoTotal = 0;

    for (const row of aggRows) {
      const debit = Number(row.totalDebit);
      const credit = Number(row.totalCredit);

      let direction: 'collected' | 'deductible_bs' | 'deductible_immo';
      let netAmount = 0;

      if (row.accountPrefix === collectedPrefix) {
        direction = 'collected';
        // Sens crédit: crédit - débit
        netAmount = credit - debit;
      } else if (deductibleBsPrefixes.includes(row.accountPrefix as any)) {
        direction = 'deductible_bs';
        // Sens débit: débit - crédit
        netAmount = debit - credit;
      } else if (row.accountPrefix === deductibleImmoPrefix) {
        direction = 'deductible_immo';
        // Sens débit: débit - crédit
        netAmount = debit - credit;
      } else {
        continue;
      }

      // Clamping netAmount to 0 to avoid violating non-negative DB constraints
      const amount = Math.max(0, netAmount);

      if (amount > 0) {
        const line = new TvaDeclarationLineEntity();
        line.direction = direction;
        line.accountPrefix = row.accountPrefix;
        line.accountLabel = row.accountLabel;
        line.amount = amount.toFixed(2);
        lines.push(line);

        if (direction === 'collected') {
          tvaCollecteeTotal += amount;
        } else if (direction === 'deductible_bs') {
          tvaDeductibleBsTotal += amount;
        } else if (direction === 'deductible_immo') {
          tvaDeductibleImmoTotal += amount;
        }
      }
    }

    // Mutually exclusive Decaisser vs Credit Reportable
    const diff = tvaCollecteeTotal - (tvaDeductibleBsTotal + tvaDeductibleImmoTotal);
    const tvaADecaisser = Math.max(0, diff);
    const creditTvaReportable = Math.max(0, -diff);

    // 6. Save declaration and lines in a transaction
    const declaration = await this.dataSource.transaction(async (manager) => {
      const declRepo = manager.getRepository(TvaDeclarationEntity);
      const lineRepo = manager.getRepository(TvaDeclarationLineEntity);

      const decl = declRepo.create({
        organizationId,
        periodYear,
        periodMonth,
        status: 'calculated',
        tvaCollecteeTotal: tvaCollecteeTotal.toFixed(2),
        tvaDeductibleBsTotal: tvaDeductibleBsTotal.toFixed(2),
        tvaDeductibleImmoTotal: tvaDeductibleImmoTotal.toFixed(2),
        tvaADecaisser: tvaADecaisser.toFixed(2),
        creditTvaReportable: creditTvaReportable.toFixed(2),
        computedAt: new Date(),
        computedById: actorId,
      });

      const savedDecl = await declRepo.save(decl);

      for (const line of lines) {
        line.declarationId = savedDecl.id;
      }

      if (lines.length > 0) {
        const savedLines = await lineRepo.save(lines);
        for (const line of savedLines) {
          delete (line as any).declaration;
        }
        savedDecl.lines = savedLines;
      } else {
        savedDecl.lines = [];
      }

      return savedDecl;
    });

    await this.audit
      .record({
        module: TvaDeclarationsService.MODULE,
        action: 'declaration_computed',
        entityType: 'tva_declaration',
        entityId: declaration.id,
        after: {
          periodYear: declaration.periodYear,
          periodMonth: declaration.periodMonth,
          status: declaration.status,
          tvaCollecteeTotal: declaration.tvaCollecteeTotal,
          tvaDeductibleBsTotal: declaration.tvaDeductibleBsTotal,
          tvaDeductibleImmoTotal: declaration.tvaDeductibleImmoTotal,
          tvaADecaisser: declaration.tvaADecaisser,
          creditTvaReportable: declaration.creditTvaReportable,
        },
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));

    return declaration;
  }

  async listForOrg(
    organizationId: TenantId,
    filters: { status?: 'draft' | 'calculated' | 'cancelled'; periodYear?: number } = {},
  ): Promise<TvaDeclarationEntity[]> {
    assertTenantId(organizationId);
    return this.tvaDeclarationRepo.listByOrganization(organizationId, filters);
  }

  async findById(id: string, organizationId: TenantId): Promise<TvaDeclarationEntity> {
    assertTenantId(organizationId);
    const decl = await this.tvaDeclarationRepo.findById(id, organizationId);
    if (!decl) {
      throw new AppException(ERROR_CODES.TVA_DECLARATION_NOT_FOUND, {
        message: `Déclaration TVA '${id}' introuvable.`,
      });
    }
    return decl;
  }

  async cancelDeclaration(
    id: string,
    organizationId: TenantId,
    input: CancelDeclarationInput,
    actorId: string,
    ctx: AuditContext,
  ): Promise<TvaDeclarationEntity> {
    assertTenantId(organizationId);
    const decl = await this.findById(id, organizationId);

    if (decl.status !== 'calculated') {
      throw new AppException(ERROR_CODES.TVA_DECLARATION_NOT_CALCULATED, {
        message: `Seule une déclaration au statut 'calculated' peut être annulée. Statut actuel: '${decl.status}'.`,
      });
    }

    decl.status = 'cancelled';
    decl.cancelledAt = new Date();
    decl.cancelledById = actorId;
    decl.cancelledReason = input.reason ?? null;

    const saved = await this.tvaDeclarationRepo.save(decl);

    await this.audit
      .record({
        module: TvaDeclarationsService.MODULE,
        action: 'declaration_cancelled',
        entityType: 'tva_declaration',
        entityId: saved.id,
        before: { status: 'calculated' },
        after: {
          status: 'cancelled',
          cancelledReason: saved.cancelledReason,
        },
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));

    return saved;
  }
}
