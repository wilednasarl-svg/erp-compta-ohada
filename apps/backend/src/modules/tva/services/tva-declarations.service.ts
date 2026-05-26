import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { EntriesService, type CreateLineInput, type EntryView } from '../../journals/services/entries.service';
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

export interface CentralizeDeclarationResult {
  readonly declaration: TvaDeclarationEntity;
  readonly journalEntry: EntryView;
}

/** Journal d'opérations diverses (OD) — convention SYSCOHADA. */
const TVA_CENTRALIZATION_JOURNAL_CODE = 'OD';

@Injectable()
export class TvaDeclarationsService {
  private static readonly MODULE = 'tva' as const;
  private readonly logger = new Logger(TvaDeclarationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tvaDeclarationRepo: TvaDeclarationRepository,
    private readonly tvaAggregationRepo: TvaAggregationRepository,
    private readonly audit: AuditTrailService,
    private readonly entriesService: EntriesService,
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
      } else if ((deductibleBsPrefixes as readonly string[]).includes(row.accountPrefix)) {
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
          delete (line as Partial<TvaDeclarationLineEntity>).declaration;
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

    // Une déclaration centralisée a déjà engendré une écriture comptable :
    // l'annuler sans contre-passation laisserait les comptes 443/445x soldés
    // dans le journal alors que la déclaration n'existe plus. Le comptable
    // doit d'abord annuler l'écriture (qui libère le lien via FK ON DELETE
    // SET NULL) avant de pouvoir annuler la déclaration.
    if (decl.centralizationJournalEntryId != null) {
      throw new AppException(ERROR_CODES.TVA_DECLARATION_CENTRALIZED_CANNOT_CANCEL, {
        message:
          'Cette déclaration a été centralisée : annulez d\'abord l\'écriture de centralisation dans le journal OD, puis ré-essayez.',
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

  /**
   * W4.1 — Centralisation TVA (Tome 1 G08, R15).
   *
   * À partir d'une déclaration `calculated`, génère une écriture de
   * journal `OD` qui solde les comptes 443 (TVA collectée) et 445x
   * (TVA déductible) vers 4441 (TVA due) ou 4449 (Crédit reportable).
   *
   * Construction des lignes (les montants sont les nets calculés à
   * `computeDeclaration` — relire à nouveau l'agrégation ferait courir
   * un risque d'incohérence si de nouvelles écritures sont validées
   * après le calcul) :
   *
   *   Cas TVA due (collectée > déductibles) :
   *     D 443   = tvaCollecteeTotal
   *     C 4451  = tvaDeductibleImmoTotal (si > 0)
   *     C 4452..4455 = tvaDeductibleBsTotal (regroupé sur 4452 par défaut)
   *     C 4441  = tvaADecaisser
   *
   *   Cas crédit reportable (déductibles > collectée) :
   *     D 443   = tvaCollecteeTotal
   *     C 4451..4455 = totaux déductibles
   *     D 4449  = creditTvaReportable
   *
   * Verrouille la déclaration : un second appel échoue avec
   * `TVA_ALREADY_CENTRALIZED`. La déclaration doit être au statut
   * `calculated` (sinon `TVA_DECLARATION_NOT_CALCULATED`).
   */
  async centralize(
    organizationId: TenantId,
    declarationId: string,
    actorId: string,
    ctx: AuditContext,
  ): Promise<CentralizeDeclarationResult> {
    assertTenantId(organizationId);

    const decl = await this.findById(declarationId, organizationId);

    if (decl.status !== 'calculated') {
      throw new AppException(ERROR_CODES.TVA_DECLARATION_NOT_CALCULATED, {
        message: `Seule une déclaration au statut 'calculated' peut être centralisée. Statut actuel: '${decl.status}'.`,
      });
    }

    if (decl.centralizationJournalEntryId || decl.centralizedAt) {
      throw new AppException(ERROR_CODES.TVA_ALREADY_CENTRALIZED, {
        message: `La déclaration TVA ${declarationId} a déjà été centralisée le ${
          decl.centralizedAt?.toISOString() ?? '?'
        }.`,
      });
    }

    const collected = Number(decl.tvaCollecteeTotal);
    const deductibleBs = Number(decl.tvaDeductibleBsTotal);
    const deductibleImmo = Number(decl.tvaDeductibleImmoTotal);
    const toPay = Number(decl.tvaADecaisser);
    const creditReportable = Number(decl.creditTvaReportable);

    if (collected <= 0 && deductibleBs <= 0 && deductibleImmo <= 0) {
      // Une période vide n'a rien à centraliser — mais on respecte
      // l'invariant : signaler explicitement plutôt que produire une
      // écriture vide rejetée par `EntriesService`.
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_EMPTY_LINES, {
        message:
          'Aucun mouvement TVA sur la période : la centralisation n\'a pas d\'objet.',
      });
    }

    const lines = this.buildCentralizationLines({
      collected,
      deductibleBs,
      deductibleImmo,
      toPay,
      creditReportable,
    });

    // Date de l'écriture : dernier jour de la période.
    const lastDay = new Date(decl.periodYear, decl.periodMonth, 0).getDate();
    const entryDate = `${decl.periodYear}-${String(decl.periodMonth).padStart(2, '0')}-${String(
      lastDay,
    ).padStart(2, '0')}`;

    const description = `Centralisation TVA ${String(decl.periodMonth).padStart(2, '0')}/${decl.periodYear}`;

    // L'écriture est créée en `draft` et **non auto-validée** : le
    // comptable doit la relire et la valider via le module journals.
    // Cohérent avec la doctrine W4.1 (le système propose la centralisation,
    // l'humain l'engage). L'idempotence est portée par
    // `centralizationJournalEntryId` côté déclaration — si le comptable
    // supprime le draft, le FK `ON DELETE SET NULL` libère la déclaration
    // pour une re-centralisation.
    const journalEntry = await this.entriesService.createDraft(
      organizationId,
      {
        journalCode: TVA_CENTRALIZATION_JOURNAL_CODE,
        entryDate,
        description,
        reference: `TVA-${decl.periodYear}-${String(decl.periodMonth).padStart(2, '0')}`,
        sourceType: 'tax_centralization',
        lines,
      },
      actorId,
      ctx,
    );

    decl.centralizationJournalEntryId = journalEntry.id;
    decl.centralizedAt = new Date();
    const saved = await this.tvaDeclarationRepo.save(decl);

    await this.audit
      .record({
        module: TvaDeclarationsService.MODULE,
        action: 'declaration_centralized',
        entityType: 'tva_declaration',
        entityId: saved.id,
        after: {
          centralizationJournalEntryId: saved.centralizationJournalEntryId,
          centralizedAt: saved.centralizedAt,
          tvaADecaisser: saved.tvaADecaisser,
          creditTvaReportable: saved.creditTvaReportable,
        },
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));

    return { declaration: saved, journalEntry };
  }

  /**
   * Construit les lignes de l'écriture de centralisation. Fonction pure
   * (pas d'accès DB) pour rester testable de manière isolée.
   *
   * Convention SYSCOHADA :
   *   - 443  est un compte de passif soldé en débit (annule le crédit).
   *   - 4451 / 4452 sont des comptes d'actif soldés en crédit.
   *   - 4441 (TVA due) : crédit si dette envers l'État.
   *   - 4449 (crédit reportable) : débit si avoir sur l'État.
   *
   * Les sous-comptes 4453 / 4454 / 4455 sont agrégés dans `tvaDeductibleBsTotal`
   * en wave 1 — on les regroupe sur la racine `4452` pour la
   * contrepartie. Une future wave 2 pourra ventiler par sous-compte.
   */
  private buildCentralizationLines(input: {
    collected: number;
    deductibleBs: number;
    deductibleImmo: number;
    toPay: number;
    creditReportable: number;
  }): CreateLineInput[] {
    const { collected, deductibleBs, deductibleImmo, toPay, creditReportable } = input;
    const lines: CreateLineInput[] = [];

    if (collected > 0) {
      lines.push({
        accountCode: TVA_ACCOUNT_PREFIXES.collected,
        debit: collected,
        credit: 0,
        description: 'Solde TVA collectée',
      });
    }

    if (deductibleImmo > 0) {
      lines.push({
        accountCode: TVA_ACCOUNT_PREFIXES.deductibleImmo,
        debit: 0,
        credit: deductibleImmo,
        description: 'Solde TVA déductible sur immobilisations',
      });
    }

    if (deductibleBs > 0) {
      lines.push({
        accountCode: TVA_ACCOUNT_PREFIXES.deductibleBs[0],
        debit: 0,
        credit: deductibleBs,
        description: 'Solde TVA déductible biens & services',
      });
    }

    if (toPay > 0) {
      lines.push({
        accountCode: TVA_ACCOUNT_PREFIXES.due,
        debit: 0,
        credit: toPay,
        description: 'TVA due (à décaisser)',
      });
    } else if (creditReportable > 0) {
      lines.push({
        accountCode: TVA_ACCOUNT_PREFIXES.creditReportable,
        debit: creditReportable,
        credit: 0,
        description: 'Crédit TVA reportable',
      });
    }

    return lines;
  }
}
