import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { type TenantId } from '../../../common/persistence/tenant-scope';
import { CashFlowService } from '../../reports/services/cash-flow.service';
import { ReportsService } from '../../reports/services/reports.service';
import {
  SyscohadaKnowledgeService,
  type SyscohadaControlWithEvidence,
  type SyscohadaDomain,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

export type ComplianceStatus = 'pass' | 'fail' | 'not_evaluable';

export interface ComplianceCheckResult {
  readonly controlId: string;
  readonly domain: SyscohadaDomain;
  readonly status: ComplianceStatus;
  readonly detail: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly control: SyscohadaControlWithEvidence | null;
}

export type ComplianceVerdict = 'compliant' | 'non_compliant' | 'partial';

export interface SyscohadaComplianceReport {
  readonly organizationId: string;
  readonly fiscalYearStartDate: string;
  readonly asAtDate: string;
  readonly evaluatedAt: string;
  readonly verdict: ComplianceVerdict;
  readonly counts: {
    readonly pass: number;
    readonly fail: number;
    readonly notEvaluable: number;
  };
  readonly results: ReadonlyArray<ComplianceCheckResult>;
}

export interface ComplianceQuery {
  readonly fiscalYearStartDate: string;
  readonly asAtDate: string;
}

interface CheckContext extends ComplianceQuery {
  readonly organizationId: TenantId;
}

interface ExecutableCheck {
  readonly controlId: string;
  readonly domain: SyscohadaDomain;
  run(
    ctx: CheckContext,
  ): Promise<{ status: ComplianceStatus; detail: string; data?: Record<string, unknown> }>;
}

const AMOUNT_EPSILON = 0.01;
const CASHFLOW_EPSILON = 1;

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'erreur inattendue';
}

@Injectable()
export class SyscohadaComplianceService {
  private readonly logger = new Logger(SyscohadaComplianceService.name);
  private readonly checks: ReadonlyArray<ExecutableCheck>;

  constructor(
    private readonly reports: ReportsService,
    private readonly cashFlow: CashFlowService,
    @Inject(DataSource) private readonly dataSource: DataSource,
    private readonly knowledge: SyscohadaKnowledgeService,
  ) {
    this.checks = [
      this.balanceSheetEquilibriumCheck(),
      this.doubleEntryBalanceCheck(),
      this.cashFlowReconciliationCheck(),
    ];
  }

  async evaluate(
    organizationId: TenantId,
    query: ComplianceQuery,
  ): Promise<SyscohadaComplianceReport> {
    const ctx: CheckContext = { organizationId, ...query };
    const results: ComplianceCheckResult[] = [];

    for (const check of this.checks) {
      let outcome: { status: ComplianceStatus; detail: string; data?: Record<string, unknown> };
      try {
        outcome = await check.run(ctx);
      } catch (e: unknown) {
        outcome = {
          status: 'not_evaluable',
          detail: `Evaluation impossible : ${errorMessage(e)}`,
        };
      }

      results.push({
        controlId: check.controlId,
        domain: check.domain,
        status: outcome.status,
        detail: outcome.detail,
        data: outcome.data,
        control: this.findControl(check.domain, check.controlId),
      });
    }

    const counts = {
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      notEvaluable: results.filter((r) => r.status === 'not_evaluable').length,
    };
    const verdict: ComplianceVerdict =
      counts.fail > 0 ? 'non_compliant' : counts.notEvaluable > 0 ? 'partial' : 'compliant';

    this.logger.log(
      `SYSCOHADA compliance org=${organizationId} asAt=${query.asAtDate} verdict=${verdict} ` +
        `(pass=${counts.pass} fail=${counts.fail} n/a=${counts.notEvaluable})`,
    );

    return {
      organizationId,
      fiscalYearStartDate: query.fiscalYearStartDate,
      asAtDate: query.asAtDate,
      evaluatedAt: new Date().toISOString(),
      verdict,
      counts,
      results,
    };
  }

  private findControl(
    domain: SyscohadaDomain,
    controlId: string,
  ): SyscohadaControlWithEvidence | null {
    return this.knowledge.getModuleControls(domain).find((c) => c.id === controlId) ?? null;
  }

  private balanceSheetEquilibriumCheck(): ExecutableCheck {
    return {
      controlId: 'bilan-actif-egal-passif',
      domain: 'reports',
      run: async (ctx) => {
        const bilan = await this.reports.getBalanceSheet(ctx.organizationId, {
          asAtDate: ctx.asAtDate,
          fiscalYearStartDate: ctx.fiscalYearStartDate,
        });
        const actif = num(bilan.totals.actif);
        const passif = num(bilan.totals.passif);
        const difference = num(bilan.totals.difference) || Number((actif - passif).toFixed(2));
        const ok = Math.abs(difference) <= AMOUNT_EPSILON;
        return {
          status: ok ? 'pass' : 'fail',
          detail: ok
            ? `Bilan equilibre au ${ctx.asAtDate} : actif = passif = ${bilan.totals.actif}.`
            : `Bilan desequilibre au ${ctx.asAtDate} : actif ${bilan.totals.actif} != passif ${bilan.totals.passif} (ecart ${difference}).`,
          data: {
            actif: bilan.totals.actif,
            passif: bilan.totals.passif,
            difference,
          },
        };
      },
    };
  }

  private doubleEntryBalanceCheck(): ExecutableCheck {
    return {
      controlId: 'journal-equilibre-partie-double',
      domain: 'journals',
      run: async (ctx) => {
        const rows = await this.dataSource.query<
          Array<{ id: string; entry_number: string; imbalance: string }>
        >(
          `SELECT e.id::text AS id,
                  e.entry_number::text AS entry_number,
                  ROUND(SUM(l.debit) - SUM(l.credit), 2)::text AS imbalance
             FROM journal_entry_lines l
             JOIN journal_entries e ON e.id = l.journal_entry_id
            WHERE l.organization_id = $1
              AND e.status = 'validated'
              AND e.entry_date BETWEEN $2::date AND $3::date
            GROUP BY e.id, e.entry_number
           HAVING ROUND(SUM(l.debit) - SUM(l.credit), 2) <> 0
            ORDER BY e.entry_number
            LIMIT 50`,
          [ctx.organizationId, ctx.fiscalYearStartDate, ctx.asAtDate],
        );
        const ok = rows.length === 0;
        return {
          status: ok ? 'pass' : 'fail',
          detail: ok
            ? 'Toutes les ecritures validees de la periode sont equilibrees (debit = credit).'
            : `${rows.length} ecriture(s) validee(s) desequilibree(s) detectee(s) sur la periode.`,
          data: {
            unbalancedCount: rows.length,
            samples: rows.map((r) => ({ entryNumber: r.entry_number, imbalance: r.imbalance })),
          },
        };
      },
    };
  }

  private cashFlowReconciliationCheck(): ExecutableCheck {
    return {
      controlId: 'cashflow-variation-coherente',
      domain: 'cash-flow',
      run: async (ctx) => {
        const report = await this.cashFlow.getCashFlow(ctx.organizationId, {
          fromDate: ctx.fiscalYearStartDate,
          toDate: ctx.asAtDate,
        });
        const coherenceCheck = Math.abs(num(report.coherenceCheck));
        const ok = coherenceCheck <= CASHFLOW_EPSILON;
        return {
          status: ok ? 'pass' : 'fail',
          detail: ok
            ? `TFT coherent au ${ctx.asAtDate} : tresorerie de cloture reconciliee aux comptes de classe 5.`
            : `TFT non reconcilie au ${ctx.asAtDate} : ecart de tresorerie ${coherenceCheck.toFixed(
                2,
              )} entre ZH et les comptes de classe 5.`,
          data: {
            coherenceCheck,
            closingCash: report.closingCash,
            netCashVariation: report.netCashVariation,
          },
        };
      },
    };
  }
}
