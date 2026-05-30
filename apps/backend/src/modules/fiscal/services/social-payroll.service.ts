import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { sumAmounts } from '../lib/fiscal-calc';
import { cappedSum, flatContribution, progressiveContribution } from '../lib/social-contributions';
import { SocialPayrollLineEntity } from '../entities/social-payroll-line.entity';
import { FiscalDeclarationEntity } from '../entities/fiscal-declaration.entity';
import { SocialPayrollRepository } from '../repositories/social-payroll.repository';
import { FiscalParameterRepository } from '../repositories/fiscal-parameter.repository';
import { FiscalTaxBracketRepository } from '../repositories/fiscal-tax-bracket.repository';
import { FiscalDeclarationsService } from './fiscal-declarations.service';

export interface SocialContributionLine {
  readonly taxCode: string;
  readonly label: string;
  readonly base: string;
  readonly amountDue: string;
  /** `progressive` = barème (ITS) ; `flat` = taux plafonné par tête. */
  readonly mode: 'progressive' | 'flat';
}

export interface SocialPeriodSummary {
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly employeeCount: number;
  readonly grossTotal: string;
  readonly contributions: SocialContributionLine[];
  readonly totalDue: string;
}

@Injectable()
export class SocialPayrollService {
  constructor(
    private readonly payroll: SocialPayrollRepository,
    private readonly params: FiscalParameterRepository,
    private readonly brackets: FiscalTaxBracketRepository,
    private readonly declarations: FiscalDeclarationsService,
  ) {}

  async upsertLine(
    organizationId: TenantId,
    input: {
      periodYear: number;
      periodMonth: number;
      employeeRef: string;
      grossSalary: string;
      createdById?: string | null;
    },
  ): Promise<SocialPayrollLineEntity> {
    return this.payroll.upsert({ organizationId, ...input });
  }

  async listLines(
    organizationId: TenantId,
    periodYear: number,
    periodMonth: number,
  ): Promise<SocialPayrollLineEntity[]> {
    return this.payroll.listForPeriod(organizationId, periodYear, periodMonth);
  }

  async deleteLine(id: string, organizationId: TenantId): Promise<void> {
    const ok = await this.payroll.deleteById(id, organizationId);
    if (!ok) {
      throw new AppException(ERROR_CODES.FISCAL_DECLARATION_NOT_FOUND, {
        message: `Ligne de paie ${id} introuvable`,
        details: { id },
      });
    }
  }

  /**
   * Calcule, par tête, les contributions sociales de la période à partir des
   * lignes de paie et des paramètres sociaux effectifs. Ne persiste rien.
   */
  async computeSummary(
    organizationId: TenantId,
    periodYear: number,
    periodMonth: number,
  ): Promise<SocialPeriodSummary> {
    const lines = await this.payroll.listForPeriod(organizationId, periodYear, periodMonth);
    const grosses = lines.map((l) => l.grossSalary);
    const onDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;

    const socialParams = await this.params.list(organizationId, {
      activeOnly: true,
      declarationKind: 'social',
    });
    const taxCodes = [...new Set(socialParams.map((p) => p.taxCode))];

    const contributions: SocialContributionLine[] = [];
    for (const taxCode of taxCodes) {
      const param = await this.params.findEffective(organizationId, taxCode, onDate);
      if (!param) continue;
      const taxBrackets = await this.brackets.findEffective(organizationId, taxCode, onDate);

      if (taxBrackets.length > 0) {
        contributions.push({
          taxCode,
          label: param.label,
          base: sumAmounts(grosses),
          amountDue: progressiveContribution(grosses, taxBrackets),
          mode: 'progressive',
        });
      } else {
        contributions.push({
          taxCode,
          label: param.label,
          base: cappedSum(grosses, param.ceiling),
          amountDue: flatContribution(grosses, param.rate, param.ceiling),
          mode: 'flat',
        });
      }
    }

    return {
      periodYear,
      periodMonth,
      employeeCount: lines.length,
      grossTotal: sumAmounts(grosses),
      contributions,
      totalDue: sumAmounts(contributions.map((c) => c.amountDue)),
    };
  }

  /**
   * Génère/met à jour les déclarations sociales de la période à partir du
   * calcul par tête : le montant dû exact est injecté (`amountOverride`) pour
   * court-circuiter le calcul agrégé (faux pour le plafond/le progressif).
   */
  async generateDeclarations(
    organizationId: TenantId,
    periodYear: number,
    periodMonth: number,
    actorUserId: string | null,
  ): Promise<FiscalDeclarationEntity[]> {
    const summary = await this.computeSummary(organizationId, periodYear, periodMonth);
    const generated: FiscalDeclarationEntity[] = [];
    for (const c of summary.contributions) {
      const decl = await this.declarations.generate(organizationId, {
        taxCode: c.taxCode,
        periodYear,
        periodMonth,
        baseAmount: c.base,
        amountOverride: c.amountDue,
        comment: `Calculé par tête sur ${summary.employeeCount} salarié(s)`,
        createdById: actorUserId,
      });
      generated.push(decl);
    }
    return generated;
  }
}
