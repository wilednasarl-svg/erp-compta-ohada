import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { type TenantId } from '../../../common/persistence/tenant-scope';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { NoteAnnexeCommentsRepository } from '../repositories/note-annexe-comments.repository';
import { ReportsService } from './reports.service';
import { ALL_NOTE_IDS, NOTE_REGISTRY } from './notes-annexes/note-registry';

/**
 * Sévérité d'un constat de validation DSF.
 *
 *   - `BLOCK` : empêche le dépôt légal (incohérence chiffrée).
 *   - `WARN`  : autorise le dépôt mais signale un risque à corriger.
 *   - `INFO`  : information sans impact bloquant.
 */
export type DsfSeverity = 'BLOCK' | 'WARN' | 'INFO';

/**
 * Verdict global de la validation. Strictement dérivé de la pire
 * sévérité présente :
 *   - au moins un `BLOCK` → `BLOCK`
 *   - sinon au moins un `WARN` → `WARN`
 *   - sinon `PASS`
 */
export type DsfVerdict = 'PASS' | 'WARN' | 'BLOCK';

/** Un constat de validation individuel. */
export interface DsfIssue {
  readonly severity: DsfSeverity;
  /** Code stable pour matching côté frontend / monitoring. */
  readonly code: string;
  /** Message human-readable en français. */
  readonly message: string;
  /** Contexte structuré optionnel (montants, IDs, etc.). */
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Rapport de validation pré-dépôt DSF.
 *
 * Source de vérité unique pour la décision « peut-on déposer ? ».
 * Consommé par l'endpoint `POST /reports/dsf-package/validate` et,
 * à terme, en pré-condition de l'endpoint de génération du ZIP DSF.
 */
export interface DsfValidationReport {
  readonly exerciseId: string;
  readonly exerciseLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly fiscalYear: number;
  readonly validatedAt: string;
  readonly verdict: DsfVerdict;
  readonly counts: {
    readonly block: number;
    readonly warn: number;
    readonly info: number;
  };
  readonly issues: ReadonlyArray<DsfIssue>;
}

/**
 * Tolérance d'arrondi sur les comparaisons de montants (en unités de
 * compte — FCFA). Les soldes DECIMAL(15,2) sont sérialisés en string
 * puis convertis en number pour la comparaison ; à 2 décimales, 0.01
 * couvre l'erreur d'arrondi cumulée acceptable.
 */
const AMOUNT_EPSILON = 0.01;

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `DsfValidatorService` — W5.4. Valide la cohérence d'un exercice
 * comptable avant dépôt DSF (Déclaration Statistique et Fiscale) au
 * greffe / DGI.
 *
 * Le service NE lance PAS d'exception sur incohérence : il accumule les
 * constats dans un rapport structuré. C'est à l'appelant de décider de
 * bloquer une action en aval (génération PDF, dépôt) selon le verdict.
 *
 * Tous les checks sont read-only et idempotents — sûr à appeler à la
 * demande depuis l'UI.
 */
@Injectable()
export class DsfValidatorService {
  private readonly logger = new Logger(DsfValidatorService.name);

  constructor(
    private readonly reports: ReportsService,
    private readonly periodRepo: AccountingPeriodRepository,
    private readonly noteCommentsRepo: NoteAnnexeCommentsRepository,
  ) {}

  /**
   * Valide l'exercice annuel identifié par `exerciseId` (= ID d'une
   * `AccountingPeriodEntity` de kind=`ANNUAL`).
   *
   * Lance `NotFoundException` UNIQUEMENT si la période n'existe pas
   * pour le tenant — toutes les autres incohérences sont accumulées
   * comme issues dans le rapport.
   */
  async validate(organizationId: TenantId, exerciseId: string): Promise<DsfValidationReport> {
    const period = await this.periodRepo.findById(exerciseId, organizationId);
    if (!period) {
      throw new NotFoundException(`Accounting period ${exerciseId} not found.`);
    }
    if (period.kind !== 'ANNUAL') {
      throw new NotFoundException(
        `Period ${exerciseId} is not an annual exercise (kind=${period.kind}).`,
      );
    }

    const issues: DsfIssue[] = [];

    await this.checkAnnualPeriodClosed(period.id, period.status, issues);
    await this.checkChildPeriodsClosed(organizationId, period.id, issues);
    const fiscalYear = Number(period.startDate.slice(0, 4));
    await this.checkBalanceSheetEquilibrium(
      organizationId,
      period.startDate,
      period.endDate,
      issues,
    );
    await this.checkTrialBalanceEquilibrium(
      organizationId,
      period.startDate,
      period.endDate,
      issues,
    );
    await this.checkNotesCompleteness(organizationId, period.id, issues);
    await this.checkUnclassifiedAccounts(organizationId, period.startDate, period.endDate, issues);

    const counts = {
      block: issues.filter((i) => i.severity === 'BLOCK').length,
      warn: issues.filter((i) => i.severity === 'WARN').length,
      info: issues.filter((i) => i.severity === 'INFO').length,
    };
    const verdict: DsfVerdict = counts.block > 0 ? 'BLOCK' : counts.warn > 0 ? 'WARN' : 'PASS';

    this.logger.log(
      `DSF validation org=${organizationId} exercise=${exerciseId} verdict=${verdict} ` +
        `(block=${counts.block} warn=${counts.warn} info=${counts.info})`,
    );

    return {
      exerciseId: period.id,
      exerciseLabel: period.label,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      fiscalYear,
      validatedAt: new Date().toISOString(),
      verdict,
      counts,
      issues,
    };
  }

  // Async by contract — sits alongside sibling async validators and will
  // perform DB lookups in a later wave; current body resolves synchronously.
  // eslint-disable-next-line @typescript-eslint/require-await
  private async checkAnnualPeriodClosed(
    periodId: string,
    status: 'open' | 'closed',
    issues: DsfIssue[],
  ): Promise<void> {
    if (status !== 'closed') {
      issues.push({
        severity: 'WARN',
        code: 'PERIOD_NOT_CLOSED',
        message:
          "L'exercice annuel n'est pas clôturé. Le dépôt DSF est techniquement possible mais la doctrine OHADA recommande la clôture préalable (article 54 AUDCIF).",
        context: { periodId },
      });
    }
  }

  private async checkChildPeriodsClosed(
    organizationId: TenantId,
    parentId: string,
    issues: DsfIssue[],
  ): Promise<void> {
    const children = await this.periodRepo.listChildren(parentId);
    const opens = children.filter((c) => c.status !== 'closed');
    if (opens.length > 0) {
      issues.push({
        severity: 'WARN',
        code: 'CHILD_PERIODS_OPEN',
        message: `${opens.length} sous-période(s) ne sont pas clôturées (${opens
          .map((c) => c.label)
          .join(', ')}). Les écritures peuvent encore être modifiées.`,
        context: { openChildIds: opens.map((c) => c.id), organizationId },
      });
    }
  }

  private async checkBalanceSheetEquilibrium(
    organizationId: TenantId,
    startDate: string,
    endDate: string,
    issues: DsfIssue[],
  ): Promise<void> {
    const bilan = await this.reports.getBalanceSheet(organizationId, {
      asAtDate: endDate,
      fiscalYearStartDate: startDate,
    });

    const diff = num(bilan.totals.difference);
    if (Math.abs(diff) > AMOUNT_EPSILON) {
      issues.push({
        severity: 'BLOCK',
        code: 'BILAN_UNBALANCED',
        message: `Bilan déséquilibré : actif (${bilan.totals.actif}) ≠ passif (${bilan.totals.passif}). Écart = ${bilan.totals.difference}.`,
        context: {
          actif: bilan.totals.actif,
          passif: bilan.totals.passif,
          difference: bilan.totals.difference,
        },
      });
    }
  }

  private async checkTrialBalanceEquilibrium(
    organizationId: TenantId,
    startDate: string,
    endDate: string,
    issues: DsfIssue[],
  ): Promise<void> {
    const tb = await this.reports.getTrialBalance(organizationId, {
      fromDate: startDate,
      toDate: endDate,
    });

    const dDebit = num(tb.totals.endingDebit);
    const dCredit = num(tb.totals.endingCredit);
    if (Math.abs(dDebit - dCredit) > AMOUNT_EPSILON) {
      issues.push({
        severity: 'BLOCK',
        code: 'TRIAL_BALANCE_UNBALANCED',
        message: `Balance non équilibrée : débit (${tb.totals.endingDebit}) ≠ crédit (${tb.totals.endingCredit}).`,
        context: {
          endingDebit: tb.totals.endingDebit,
          endingCredit: tb.totals.endingCredit,
        },
      });
    }

    const pDebit = num(tb.totals.periodDebit);
    const pCredit = num(tb.totals.periodCredit);
    if (Math.abs(pDebit - pCredit) > AMOUNT_EPSILON) {
      issues.push({
        severity: 'WARN',
        code: 'PERIOD_MOVEMENTS_UNBALANCED',
        message: `Mouvements de la période non équilibrés : débit (${tb.totals.periodDebit}) ≠ crédit (${tb.totals.periodCredit}). Indique un import partiel ou des écritures draft.`,
        context: {
          periodDebit: tb.totals.periodDebit,
          periodCredit: tb.totals.periodCredit,
        },
      });
    }
  }

  /**
   * Vérifie que chaque note marquée `applicableByDefault: true` dans le
   * registre a soit (a) été marquée non-applicable explicitement par le
   * comptable, soit (b) un commentaire libre non vide. La vérification
   * fine du contenu calculé (rows) demande l'instanciation des handlers
   * — déléguée à un futur audit basé sur `NotesAnnexesService` une fois
   * son wiring fait. Ici on couvre déjà l'attente DSF minimale :
   * "chaque note applicable doit avoir une décision documentée".
   */
  private async checkNotesCompleteness(
    organizationId: TenantId,
    exerciseId: string,
    issues: DsfIssue[],
  ): Promise<void> {
    const comments = await this.noteCommentsRepo.getByExercise(organizationId, exerciseId);
    const commentByNoteId = new Map(comments.map((c) => [c.noteId, c]));

    for (const noteId of ALL_NOTE_IDS) {
      const entry = NOTE_REGISTRY.get(noteId);
      if (!entry || !entry.metadata.applicableByDefault) continue;

      const comment = commentByNoteId.get(noteId);
      // Si le comptable a explicitement marqué N/A → conforme (décision documentée).
      if (comment && !comment.applicable) continue;

      // Si applicable (par défaut OU forcée) : exiger un freeComment non vide.
      const hasComment =
        comment && typeof comment.commentText === 'string' && comment.commentText.trim().length > 0;
      if (!hasComment) {
        issues.push({
          severity: 'WARN',
          code: 'NOTE_COMMENT_MISSING',
          message: `Note ${noteId} (${entry.metadata.label}) marquée applicable mais sans commentaire libre. La doctrine OHADA exige un contenu documenté (même "néant" explicite).`,
          context: { noteId },
        });
      }
    }
  }

  private async checkUnclassifiedAccounts(
    organizationId: TenantId,
    startDate: string,
    endDate: string,
    issues: DsfIssue[],
  ): Promise<void> {
    const bilan = await this.reports.getBalanceSheet(organizationId, {
      asAtDate: endDate,
      fiscalYearStartDate: startDate,
    });
    if (bilan.unclassified.length > 0) {
      const totalUnclassified = bilan.unclassified.reduce(
        (sum, p) => sum + Math.abs(num(p.net)),
        0,
      );
      issues.push({
        severity: 'INFO',
        code: 'UNCLASSIFIED_ACCOUNTS',
        message: `${bilan.unclassified.length} compte(s) non classés dans la hiérarchie SYSCOHADA (total absolu ${totalUnclassified.toFixed(2)}). Vérifier le plan comptable de l'organisation.`,
        context: {
          count: bilan.unclassified.length,
          codes: bilan.unclassified.map((p) => p.code),
        },
      });
    }
  }
}
