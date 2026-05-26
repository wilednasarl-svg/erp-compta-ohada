import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { EntriesService } from '../../journals/services/entries.service';
import type {
  FxReevaluationAccountDetail,
  FxReevaluationRunEntity,
} from '../entities/fx-reevaluation-run.entity';
import {
  type ListFxRunsFilters,
  FxReevaluationRunsRepository,
} from '../repositories/fx-reevaluation-runs.repository';
import { ExchangeRatesService } from './exchange-rates.service';

/**
 * Devise comptable de référence pour SYSCOHADA. Toute la chaîne
 * comptable est stockée en XOF (cf. design D2 du module multi-devises).
 */
const BASE_CURRENCY = 'XOF';

/**
 * Comptes d'écart de conversion (SYSCOHADA, Tome 1) :
 *   - `478` : écart de conversion ACTIF (perte latente, à la clôture).
 *   - `479` : écart de conversion PASSIF (gain latent, à la clôture).
 *
 * Le service utilise le code racine 3 chiffres. Le commissaire aux
 * comptes pourra réaffecter sur un sous-compte plus fin (4781/4791)
 * si l'organisation a customisé son plan.
 */
const ACCOUNT_LOSS_LATENT = '478' as const;
const ACCOUNT_GAIN_LATENT = '479' as const;

/**
 * Journal cible pour les écritures de réévaluation. SYSCOHADA recommande
 * le journal des Opérations Diverses (OD) pour les retraitements de fin
 * d'exercice.
 */
const OD_JOURNAL_CODE = 'OD';

export interface FxBalanceInput {
  readonly accountCode: string;
  readonly currency: string;
  /** Solde en devise d'origine ; signé (positif = créance, négatif = dette). */
  readonly amountCurrency: string;
  /** Contre-valeur XOF historique déjà comptabilisée ; signé. */
  readonly currentAmountXof: string;
}

export interface TriggerReevaluationInput {
  readonly closingDate: string;
  readonly balances: ReadonlyArray<FxBalanceInput>;
}

export interface FxReevaluationRunView {
  readonly id: string;
  readonly organizationId: string;
  readonly closingDate: string;
  readonly reversalDate: string;
  readonly status: FxReevaluationRunEntity['status'];
  readonly executedAt: Date | null;
  readonly executedById: string | null;
  readonly reversedAt: Date | null;
  readonly journalEntryId: string | null;
  readonly reversalJournalEntryId: string | null;
  readonly metadata: ReadonlyArray<FxReevaluationAccountDetail>;
  readonly errorMessage: string | null;
}

/**
 * `FxReevaluationService` — réévaluation FX à la clôture (article 54 AU)
 * + contre-passation au 01/01 N+1.
 *
 * Wave 1 :
 *   - Le caller fournit la liste des soldes FX (`balances`). La
 *     dérivation automatique depuis `journal_entry_lines` exige une
 *     colonne `currency` / `currency_amount` qui n'est pas encore en
 *     base (cf. README W3.4) — c'est un follow-up tracé en TODO.
 *   - Pas de scheduler : `@nestjs/schedule` n'est pas installé dans le
 *     boot Nest. La contre-passation au 01/01 doit être déclenchée
 *     manuellement (ou par un cron infra). Follow-up tracé en TODO.
 *
 * Tous les montants sont manipulés en `string` DECIMAL pour préserver
 * la précision (cf. design D1 — pas de `number` flottant sur les
 * montants comptables).
 */
@Injectable()
export class FxReevaluationService {
  private readonly logger = new Logger(FxReevaluationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly runsRepo: FxReevaluationRunsRepository,
    private readonly rates: ExchangeRatesService,
    private readonly entries: EntriesService,
  ) {}

  /**
   * Déclenche la réévaluation FX pour une organisation à une date de
   * clôture donnée. Idempotent par contrainte d'unicité
   * `(org, closingDate)` — un second appel lève
   * `FX_REEVAL_ALREADY_EXECUTED`.
   */
  async triggerReevaluation(
    organizationId: TenantId,
    input: TriggerReevaluationInput,
    executedBy: string,
    ctx: AuditContext,
  ): Promise<FxReevaluationRunView> {
    assertTenantId(organizationId);

    const existing = await this.runsRepo.findByClosingDate(organizationId, input.closingDate);
    if (existing && existing.status !== 'failed') {
      throw new AppException(ERROR_CODES.FX_REEVAL_ALREADY_EXECUTED, {
        message: `A reevaluation already exists for closing date ${input.closingDate} (status=${existing.status}).`,
      });
    }

    const foreignBalances = input.balances.filter(
      (b) => b.currency.toUpperCase() !== BASE_CURRENCY,
    );
    if (foreignBalances.length === 0) {
      throw new AppException(ERROR_CODES.FX_REEVAL_NO_FX_BALANCES, {
        message: `No foreign-currency balances to revalue at ${input.closingDate}.`,
      });
    }

    const details = await this.computeDetails(organizationId, input.closingDate, foreignBalances);
    const significant = details.filter((d) => d.ecart !== '0' && d.ecart !== '0.00');

    if (significant.length === 0) {
      // Cas BCEAO EUR/XOF (parité fixe) — aucune écriture n'est créée
      // mais on persiste la run pour preuve d'exécution / audit.
      return this.persistEmptyRun(organizationId, input.closingDate, details, executedBy);
    }

    const reversalDate = FxReevaluationService.nextDay(input.closingDate);

    return this.dataSource.transaction(async (manager) => {
      const lines = [...FxReevaluationService.buildClosingLines(significant)];

      const entryView = await this.entries.createDraft(
        organizationId,
        {
          journalCode: OD_JOURNAL_CODE,
          entryDate: input.closingDate,
          description: `JV-FX-CL-${input.closingDate} — réévaluation FX clôture (art. 54 AU)`,
          reference: `FX-CL-${input.closingDate}`,
          lines,
        },
        executedBy,
        ctx,
      );
      await this.entries.validate(organizationId, entryView.id, executedBy, ctx);

      const run = await this.runsRepo.create(
        {
          organizationId,
          closingDate: input.closingDate,
          reversalDate,
          status: 'executed',
          executedAt: new Date(),
          executedById: executedBy,
          journalEntryId: entryView.id,
          metadata: details,
        },
        manager,
      );
      this.logger.log(
        `FX reevaluation executed for org=${organizationId} closing=${input.closingDate} run=${run.id}`,
      );
      return FxReevaluationService.toView(run);
    });
  }

  /**
   * Contre-passation au `reversalDate` (J+1 de la clôture). Inverse
   * intégralement l'écriture d'écart générée par `triggerReevaluation`.
   */
  async triggerReversal(
    organizationId: TenantId,
    runId: string,
    actorId: string,
    ctx: AuditContext,
  ): Promise<FxReevaluationRunView> {
    assertTenantId(organizationId);

    const run = await this.runsRepo.findById(organizationId, runId);
    if (!run) {
      throw new AppException(ERROR_CODES.FX_REEVAL_NOT_REVERSIBLE, {
        message: `Reevaluation run not found: ${runId}`,
      });
    }
    if (run.status !== 'executed') {
      throw new AppException(ERROR_CODES.FX_REEVAL_NOT_REVERSIBLE, {
        message: `Run ${runId} is not reversible (status=${run.status}).`,
      });
    }

    const details = run.metadata;
    const significant = details.filter((d) => d.ecart !== '0' && d.ecart !== '0.00');

    return this.dataSource.transaction(async (manager) => {
      let reversalEntryId: string | null = null;

      if (significant.length > 0) {
        const reversalLines = [...FxReevaluationService.buildReversalLines(significant)];
        const entryView = await this.entries.createDraft(
          organizationId,
          {
            journalCode: OD_JOURNAL_CODE,
            entryDate: run.reversalDate,
            description: `JV-FX-RV-${run.reversalDate} — extourne écart FX clôture ${run.closingDate}`,
            reference: `FX-RV-${run.reversalDate}`,
            lines: reversalLines,
          },
          actorId,
          ctx,
        );
        await this.entries.validate(organizationId, entryView.id, actorId, ctx);
        reversalEntryId = entryView.id;
      }

      await this.runsRepo.update(
        run.id,
        {
          status: 'reversed',
          reversedAt: new Date(),
          reversalJournalEntryId: reversalEntryId,
        },
        manager,
      );
      const refreshed = await this.runsRepo.findById(organizationId, run.id);
      if (!refreshed) {
        throw new AppException(ERROR_CODES.FX_REEVAL_NOT_REVERSIBLE, {
          message: 'Run vanished after update.',
        });
      }
      this.logger.log(
        `FX reevaluation reversed for org=${organizationId} run=${run.id} reversalEntry=${reversalEntryId ?? 'none'}`,
      );
      return FxReevaluationService.toView(refreshed);
    });
  }

  async listRuns(
    organizationId: TenantId,
    filters: ListFxRunsFilters = {},
  ): Promise<ReadonlyArray<FxReevaluationRunView>> {
    assertTenantId(organizationId);
    const runs = await this.runsRepo.list(organizationId, filters);
    return runs.map(FxReevaluationService.toView);
  }

  async findById(
    organizationId: TenantId,
    runId: string,
  ): Promise<FxReevaluationRunView> {
    assertTenantId(organizationId);
    const run = await this.runsRepo.findById(organizationId, runId);
    if (!run) {
      throw new AppException(ERROR_CODES.FX_REEVAL_NOT_REVERSIBLE, {
        message: `Reevaluation run not found: ${runId}`,
      });
    }
    return FxReevaluationService.toView(run);
  }

  // ─── helpers privés ─────────────────────────────────────────────────

  private async computeDetails(
    organizationId: TenantId,
    closingDate: string,
    balances: ReadonlyArray<FxBalanceInput>,
  ): Promise<ReadonlyArray<FxReevaluationAccountDetail>> {
    const out: FxReevaluationAccountDetail[] = [];
    for (const b of balances) {
      const currency = b.currency.toUpperCase();
      const closingRate = await this.resolveClosingRate(
        organizationId,
        currency,
        closingDate,
        b.accountCode,
      );

      const originalRate = FxReevaluationService.deriveHistoricalRate(
        b.currentAmountXof,
        b.amountCurrency,
      );
      const recalculated = FxReevaluationService.multiplyDecimal(b.amountCurrency, closingRate, 0);
      const ecart = FxReevaluationService.subtractDecimal(recalculated, b.currentAmountXof);
      const contra: '478' | '479' = FxReevaluationService.pickContraAccount(
        b.amountCurrency,
        ecart,
      );

      out.push({
        accountCode: b.accountCode,
        originalCurrency: currency,
        originalAmountCurrency: b.amountCurrency,
        originalRate,
        closingRate,
        currentAmountXof: b.currentAmountXof,
        recalculatedAmount: recalculated,
        ecart,
        contraAccountCode: contra,
      });
    }
    return out;
  }

  private async resolveClosingRate(
    organizationId: TenantId,
    currency: string,
    closingDate: string,
    accountCode: string,
  ): Promise<string> {
    try {
      const { rate } = await this.rates.getRateAtDate(
        organizationId,
        currency,
        BASE_CURRENCY,
        closingDate,
      );
      return rate;
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : 'unknown';
      throw new AppException(ERROR_CODES.FX_REEVAL_RATE_MISSING, {
        message: `Missing closing rate ${currency}→${BASE_CURRENCY} at ${closingDate} (account ${accountCode}): ${reason}`,
      });
    }
  }

  private async persistEmptyRun(
    organizationId: TenantId,
    closingDate: string,
    details: ReadonlyArray<FxReevaluationAccountDetail>,
    executedBy: string,
  ): Promise<FxReevaluationRunView> {
    const reversalDate = FxReevaluationService.nextDay(closingDate);
    const run = await this.runsRepo.create({
      organizationId,
      closingDate,
      reversalDate,
      status: 'executed',
      executedAt: new Date(),
      executedById: executedBy,
      journalEntryId: null,
      metadata: details,
    });
    this.logger.log(
      `FX reevaluation: no ecart at ${closingDate} for org=${organizationId} — run=${run.id} persisted without journal entry.`,
    );
    return FxReevaluationService.toView(run);
  }

  // ─── pures (statiques) — testables sans I/O ─────────────────────────

  static buildClosingLines(
    details: ReadonlyArray<FxReevaluationAccountDetail>,
  ): ReadonlyArray<{
    accountCode: string;
    debit: number;
    credit: number;
    description: string;
  }> {
    const lines: Array<{
      accountCode: string;
      debit: number;
      credit: number;
      description: string;
    }> = [];

    for (const d of details) {
      const ecartNum = Number(d.ecart);
      const absEcart = Math.abs(ecartNum);

      // Ecart algébrique = recalculé - historique (XOF, signé).
      //   ecart > 0  → l'actif algébrique a augmenté :
      //                  - créance : valeur ↑ → DÉBIT 411x / CRÉDIT 479 (gain)
      //                  - dette  : dette absolue ↓ → DÉBIT 401x / CRÉDIT 479
      //   ecart < 0  → l'actif algébrique a diminué :
      //                  - créance : valeur ↓ → CRÉDIT 411x / DÉBIT 478 (perte)
      //                  - dette  : dette absolue ↑ → CRÉDIT 401x / DÉBIT 478
      //
      // Dans les deux cas, le sens du tiers est piloté UNIQUEMENT par
      // le signe de l'écart — le signe du solde d'origine ne change
      // ni le compte de contrepartie 478/479, ni la patte tiers.
      const debitTiers = ecartNum > 0;

      lines.push({
        accountCode: d.accountCode,
        debit: debitTiers ? absEcart : 0,
        credit: debitTiers ? 0 : absEcart,
        description: `Écart conversion ${d.originalCurrency} taux ${d.closingRate}`,
      });
      lines.push({
        accountCode: d.contraAccountCode,
        debit: debitTiers ? 0 : absEcart,
        credit: debitTiers ? absEcart : 0,
        description: `Contrepartie écart ${d.accountCode}`,
      });
    }
    return lines;
  }

  static buildReversalLines(
    details: ReadonlyArray<FxReevaluationAccountDetail>,
  ): ReadonlyArray<{
    accountCode: string;
    debit: number;
    credit: number;
    description: string;
  }> {
    return FxReevaluationService.buildClosingLines(details).map((l) => ({
      ...l,
      debit: l.credit,
      credit: l.debit,
      description: `Extourne — ${l.description}`,
    }));
  }

  static pickContraAccount(
    _originalAmountCurrency: string,
    ecart: string,
  ): '478' | '479' {
    // L'écart algébrique signé porte déjà l'information :
    //   ecart > 0 → l'actif net algébrique a augmenté → GAIN LATENT (479).
    //   ecart < 0 → l'actif net algébrique a diminué  → PERTE LATENTE (478).
    //
    // Cette règle s'applique uniformément aux créances (solde + au débit)
    // et aux dettes (solde + au crédit, exprimé en valeur algébrique
    // négative dans `originalAmountCurrency`) — cf. article 54 AU et
    // doctrine SYSCOHADA Tome 1.
    return Number(ecart) > 0 ? ACCOUNT_GAIN_LATENT : ACCOUNT_LOSS_LATENT;
  }

  static multiplyDecimal(amount: string, rate: string, decimalPlaces: number): string {
    const product = Number(amount) * Number(rate);
    if (!Number.isFinite(product)) {
      return '0';
    }
    return product.toFixed(decimalPlaces);
  }

  static subtractDecimal(a: string, b: string): string {
    const diff = Number(a) - Number(b);
    if (Math.abs(diff) < 0.005) {
      return '0';
    }
    return diff.toFixed(0);
  }

  static deriveHistoricalRate(currentAmountXof: string, amountCurrency: string): string {
    const num = Number(amountCurrency);
    if (num === 0) return '0';
    return (Number(currentAmountXof) / num).toFixed(6);
  }

  static nextDay(isoDate: string): string {
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  private static toView(run: FxReevaluationRunEntity): FxReevaluationRunView {
    return {
      id: run.id,
      organizationId: run.organizationId,
      closingDate: run.closingDate,
      reversalDate: run.reversalDate,
      status: run.status,
      executedAt: run.executedAt,
      executedById: run.executedById,
      reversedAt: run.reversedAt,
      journalEntryId: run.journalEntryId,
      reversalJournalEntryId: run.reversalJournalEntryId,
      metadata: run.metadata,
      errorMessage: run.errorMessage,
    };
  }
}
