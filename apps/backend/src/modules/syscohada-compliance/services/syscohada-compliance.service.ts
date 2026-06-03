import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { type TenantId } from '../../../common/persistence/tenant-scope';
import { CashFlowService } from '../../reports/services/cash-flow.service';
import { ReportsService, detectUnusualBalances } from '../../reports/services/reports.service';
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
  /**
   * Recommandation de correction (remède du catalogue) — renseignée
   * uniquement quand le contrôle échoue (`status === 'fail'`), `null`
   * sinon. Permet à l'UI d'afficher « comment corriger » à côté de
   * l'anomalie, citée par l'article AUDCIF porté par `control.legalBasis`.
   */
  readonly recommendation: string | null;
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
      this.accountSenseCheck(),
      this.accountNumberingCheck(),
      this.entryPeriodConsistencyCheck(),
      this.suspenseAccountsCheck(),
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

      const control = this.findControl(check.domain, check.controlId);
      results.push({
        controlId: check.controlId,
        domain: check.domain,
        status: outcome.status,
        detail: outcome.detail,
        data: outcome.data,
        control,
        recommendation: outcome.status === 'fail' ? (control?.remediation ?? null) : null,
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

  /**
   * Détecte les comptes au sens anormal = incohérences d'imputation
   * probables (fournisseur débiteur, client créditeur, banque créditrice…).
   * Réutilise le détecteur pur `detectUnusualBalances` du module reports,
   * appliqué au solde de clôture de la balance générale. Seules les
   * anomalies de sévérité `warning` (vraies erreurs d'imputation probables)
   * font échouer le contrôle ; les `info` (découvert bancaire, comptes
   * courants associés) sont rapportées sans bloquer.
   */
  private accountSenseCheck(): ExecutableCheck {
    return {
      controlId: 'plan-sens-normal-comptes',
      domain: 'accounting-plan',
      run: async (ctx) => {
        const trialBalance = await this.reports.getTrialBalance(ctx.organizationId, {
          fromDate: ctx.fiscalYearStartDate,
          toDate: ctx.asAtDate,
        });
        const unusual = detectUnusualBalances(
          trialBalance.rows.map((r) => ({
            code: r.accountCode,
            label: r.accountLabel,
            debit: r.endingDebit,
            credit: r.endingCredit,
          })),
        );
        const warnings = unusual.filter((u) => u.severity === 'warning');
        const ok = warnings.length === 0;
        return {
          status: ok ? 'pass' : 'fail',
          detail: ok
            ? "Aucun compte au sens anormal détecté (hors comptes d'avance dédiés 409/419)."
            : `${warnings.length} compte(s) au solde inhabituel — erreur(s) d'imputation probable(s).`,
          data: {
            unusualCount: unusual.length,
            warningCount: warnings.length,
            accounts: unusual.slice(0, 20).map((u) => ({
              code: u.code,
              label: u.label,
              sign: u.sign,
              amount: u.amount,
              severity: u.severity,
              reason: u.reason,
            })),
          },
        };
      },
    };
  }

  /**
   * Détecte les comptes dont le code ne respecte pas la codification
   * SYSCOHADA : code non numérique ou première position = 0 (aucune classe
   * 0 n'existe au plan). Conservateur — la classe 9 (engagements / analytique)
   * reste valide et n'est pas signalée. Capture surtout les codes parasites
   * issus d'un import (libellés en guise de code, préfixes erronés).
   */
  private accountNumberingCheck(): ExecutableCheck {
    return {
      controlId: 'plan-numerotation-classes',
      domain: 'accounting-plan',
      run: async (ctx) => {
        const trialBalance = await this.reports.getTrialBalance(ctx.organizationId, {
          fromDate: ctx.fiscalYearStartDate,
          toDate: ctx.asAtDate,
        });
        const invalid = trialBalance.rows.filter((r) => !/^[1-9]/.test(r.accountCode));
        const ok = invalid.length === 0;
        return {
          status: ok ? 'pass' : 'fail',
          detail: ok
            ? 'Tous les comptes mouvementés respectent la codification décimale du plan SYSCOHADA.'
            : `${invalid.length} compte(s) au code hors plan (non numérique ou classe 0).`,
          data: {
            invalidCount: invalid.length,
            accounts: invalid
              .slice(0, 20)
              .map((r) => ({ code: r.accountCode, label: r.accountLabel })),
          },
        };
      },
    };
  }

  /**
   * Détecte les écritures validées dont la date d'opération sort des bornes
   * de la période comptable à laquelle elles sont rattachées — incohérence
   * de chronologie / de rattachement à l'exercice (AUDCIF art. 17).
   */
  private entryPeriodConsistencyCheck(): ExecutableCheck {
    return {
      controlId: 'journal-chronologie-continuite',
      domain: 'journals',
      run: async (ctx) => {
        const rows = await this.dataSource.query<
          Array<{
            entry_number: string;
            entry_date: string;
            start_date: string;
            end_date: string;
          }>
        >(
          `SELECT e.entry_number::text AS entry_number,
                  e.entry_date::text   AS entry_date,
                  p.start_date::text   AS start_date,
                  p.end_date::text     AS end_date
             FROM journal_entries e
             JOIN accounting_periods p ON p.id = e.period_id
            WHERE e.organization_id = $1
              AND e.status = 'validated'
              AND e.entry_date BETWEEN $2::date AND $3::date
              AND (e.entry_date < p.start_date OR e.entry_date > p.end_date)
            ORDER BY e.entry_date
            LIMIT 50`,
          [ctx.organizationId, ctx.fiscalYearStartDate, ctx.asAtDate],
        );
        const ok = rows.length === 0;
        return {
          status: ok ? 'pass' : 'fail',
          detail: ok
            ? 'Toutes les écritures validées sont datées dans les bornes de leur période comptable.'
            : `${rows.length} écriture(s) datée(s) hors des bornes de leur période comptable.`,
          data: {
            outOfPeriodCount: rows.length,
            samples: rows.slice(0, 20).map((r) => ({
              entryNumber: r.entry_number,
              entryDate: r.entry_date,
              period: `${r.start_date} → ${r.end_date}`,
            })),
          },
        };
      },
    };
  }

  /**
   * Détecte les comptes d'attente (471) et de virements de fonds (585) non
   * soldés à la date d'arrêté. Ces comptes transitoires doivent être ramenés
   * à zéro : un solde résiduel signale une opération en suspens non imputée
   * définitivement. Préfixes précis (471/585) pour éviter les faux positifs
   * sur 47x (écarts de conversion) et 58x (régies d'avances) légitimement
   * non nuls.
   */
  private suspenseAccountsCheck(): ExecutableCheck {
    const SUSPENSE_PREFIXES = ['471', '585'];
    return {
      controlId: 'comptes-attente-soldes',
      domain: 'regularizations',
      run: async (ctx) => {
        const trialBalance = await this.reports.getTrialBalance(ctx.organizationId, {
          fromDate: ctx.fiscalYearStartDate,
          toDate: ctx.asAtDate,
        });
        const open = trialBalance.rows.filter((r) => {
          if (!SUSPENSE_PREFIXES.some((p) => r.accountCode.startsWith(p))) return false;
          const net = num(r.endingDebit) - num(r.endingCredit);
          return Math.abs(net) >= AMOUNT_EPSILON;
        });
        const ok = open.length === 0;
        return {
          status: ok ? 'pass' : 'fail',
          detail: ok
            ? "Comptes d'attente (471) et virements de fonds (585) soldés à la date d'arrêté."
            : `${open.length} compte(s) d'attente / virement de fonds non soldé(s) à la date d'arrêté.`,
          data: {
            openCount: open.length,
            accounts: open.slice(0, 20).map((r) => ({
              code: r.accountCode,
              label: r.accountLabel,
              balance: (num(r.endingDebit) - num(r.endingCredit)).toFixed(2),
            })),
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
