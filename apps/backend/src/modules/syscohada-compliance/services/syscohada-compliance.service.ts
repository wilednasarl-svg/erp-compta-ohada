import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { type TenantId } from '../../../common/persistence/tenant-scope';
import { ReportsService } from '../../reports/services/reports.service';
import {
  SyscohadaKnowledgeService,
  type SyscohadaControlWithEvidence,
  type SyscohadaDomain,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

/**
 * Résultat de l'exécution d'un contrôle SYSCOHADA sur les données réelles.
 *   - `pass`          : le contrôle est satisfait pour le périmètre demandé.
 *   - `fail`          : non-conformité avérée (avec détail chiffré).
 *   - `not_evaluable` : contrôle doctrinal connu mais non encore exécutable
 *                       automatiquement (ex. TFT sans calcul disponible) ou
 *                       données insuffisantes.
 */
export type ComplianceStatus = 'pass' | 'fail' | 'not_evaluable';

export interface ComplianceCheckResult {
  readonly controlId: string;
  readonly domain: SyscohadaDomain;
  readonly status: ComplianceStatus;
  /** Message métier français expliquant le verdict. */
  readonly detail: string;
  /** Données chiffrées de support (montants, écarts, échantillons). */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Contrôle doctrinal du catalogue + citation sourcée du Guide (null si absent). */
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
  /** Début de l'exercice (YYYY-MM-DD) — sert de borne basse et d'origine du bilan. */
  readonly fiscalYearStartDate: string;
  /** Date d'arrêté (YYYY-MM-DD) — borne haute et date du bilan. */
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

/** Contrôles bloquants doctrinaux connus mais pas encore exécutables automatiquement. */
interface DeclaredNotEvaluable {
  readonly controlId: string;
  readonly domain: SyscohadaDomain;
  readonly reason: string;
}

const AMOUNT_EPSILON = 0.01;

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'erreur inattendue';
}

/**
 * `SyscohadaComplianceService` — exécute les contrôles SYSCOHADA *bloquants*
 * sur les données comptables réelles d'une organisation et les rattache à leur
 * base doctrinale sourcée (catalogue de contrôles + extrait verbatim du Guide).
 *
 * Réutilise `ReportsService` (bilan, balance) plutôt que de recalculer : zéro
 * duplication du moteur de reporting. Read-only et idempotent — sûr à appeler
 * à la demande depuis l'UI. N'effectue AUCune écriture et ne lève pas sur
 * non-conformité : il accumule des constats dans un rapport structuré.
 */
@Injectable()
export class SyscohadaComplianceService {
  private readonly logger = new Logger(SyscohadaComplianceService.name);
  private readonly checks: ReadonlyArray<ExecutableCheck>;

  private static readonly NOT_EVALUABLE: ReadonlyArray<DeclaredNotEvaluable> = [
    {
      controlId: 'cashflow-variation-coherente',
      domain: 'cash-flow',
      reason:
        'Le Tableau des flux de trésorerie n’est pas encore calculé par le moteur de reporting ; ce contrôle reste doctrinal en attendant le calcul du TFT.',
    },
  ];

  constructor(
    private readonly reports: ReportsService,
    @Inject(DataSource) private readonly dataSource: DataSource,
    private readonly knowledge: SyscohadaKnowledgeService,
  ) {
    this.checks = [this.balanceSheetEquilibriumCheck(), this.doubleEntryBalanceCheck()];
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
          detail: `Évaluation impossible : ${errorMessage(e)}`,
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

    for (const ne of SyscohadaComplianceService.NOT_EVALUABLE) {
      results.push({
        controlId: ne.controlId,
        domain: ne.domain,
        status: 'not_evaluable',
        detail: ne.reason,
        control: this.findControl(ne.domain, ne.controlId),
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

  /** Contrôle bloquant : Total Actif = Total Passif (AUDCIF art. 8, Guide Tome 3). */
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
            ? `Bilan équilibré au ${ctx.asAtDate} : actif = passif = ${bilan.totals.actif}.`
            : `Bilan déséquilibré au ${ctx.asAtDate} : actif ${bilan.totals.actif} ≠ passif ${bilan.totals.passif} (écart ${difference}).`,
          data: {
            actif: bilan.totals.actif,
            passif: bilan.totals.passif,
            difference,
          },
        };
      },
    };
  }

  /** Contrôle bloquant : chaque écriture validée respecte Σdébit = Σcrédit. */
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
            ? 'Toutes les écritures validées de la période sont équilibrées (Σdébit = Σcrédit).'
            : `${rows.length} écriture(s) validée(s) déséquilibrée(s) détectée(s) sur la période.`,
          data: {
            unbalancedCount: rows.length,
            samples: rows.map((r) => ({ entryNumber: r.entry_number, imbalance: r.imbalance })),
          },
        };
      },
    };
  }
}
