import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { computeAmountDue, computeDueDate } from '../lib/fiscal-calc';
import { computeProgressiveTax } from '../lib/progressive-tax';
import { FiscalDeclarationEntity } from '../entities/fiscal-declaration.entity';
import {
  FiscalDeclarationRepository,
  type ListFiscalDeclarationsFilter,
} from '../repositories/fiscal-declaration.repository';
import { FiscalParameterRepository } from '../repositories/fiscal-parameter.repository';
import { FiscalTaxBracketRepository } from '../repositories/fiscal-tax-bracket.repository';
import { FiscalBaseService } from './fiscal-base.service';
import { BudgetLinesService } from '../../budget/services/budget-lines.service';
import { FISCAL_STATUS_TRANSITIONS, type FiscalDeclarationStatus } from '../types/fiscal.types';

export interface GenerateDeclarationCommand {
  readonly taxCode: string;
  readonly periodYear: number;
  readonly periodMonth?: number | null;
  /** Base imposable (du calcul comptable/budget ou saisie). Défaut "0". */
  readonly baseAmount?: string;
  readonly comment?: string;
  readonly createdById?: string | null;
}

export interface UpdateDeclarationCommand {
  readonly baseAmount?: string;
  readonly reference?: string | null;
  readonly justificatifUrl?: string | null;
  readonly comment?: string | null;
}

@Injectable()
export class FiscalDeclarationsService {
  constructor(
    private readonly declarations: FiscalDeclarationRepository,
    private readonly params: FiscalParameterRepository,
    private readonly baseService: FiscalBaseService,
    private readonly budgetLines: BudgetLinesService,
    private readonly brackets: FiscalTaxBracketRepository,
  ) {}

  async list(
    organizationId: TenantId,
    filter: ListFiscalDeclarationsFilter,
  ): Promise<{ rows: FiscalDeclarationEntity[]; total: number }> {
    return this.declarations.list(organizationId, filter);
  }

  async findById(id: string, organizationId: TenantId): Promise<FiscalDeclarationEntity> {
    const decl = await this.declarations.findById(id, organizationId);
    if (!decl) {
      throw new AppException(ERROR_CODES.FISCAL_DECLARATION_NOT_FOUND, {
        message: `Déclaration ${id} introuvable`,
        details: { id },
      });
    }
    return decl;
  }

  /**
   * Génère (ou met à jour) une déclaration : résout le paramètre applicable
   * à la période, calcule le montant dû (base × taux, plafonné) et la date
   * limite, puis upsert par clé naturelle (code × année × mois).
   */
  async generate(
    organizationId: TenantId,
    cmd: GenerateDeclarationCommand,
  ): Promise<FiscalDeclarationEntity> {
    const periodMonth = cmd.periodMonth ?? null;
    const base = cmd.baseAmount ?? '0';
    const onDate = `${cmd.periodYear}-${String(periodMonth ?? 1).padStart(2, '0')}-01`;

    const param = await this.params.findEffective(organizationId, cmd.taxCode, onDate);
    if (!param) {
      throw new AppException(ERROR_CODES.FISCAL_NO_RATE_FOR_PERIOD, {
        message: `Aucun paramètre actif pour ${cmd.taxCode} à la date ${onDate}`,
        details: { taxCode: cmd.taxCode, onDate },
      });
    }

    // Barème progressif (ITS) si des tranches sont définies pour la période ;
    // sinon taux plat × base (plafonnée).
    const taxBrackets = await this.brackets.findEffective(organizationId, cmd.taxCode, onDate);
    const amountDue =
      taxBrackets.length > 0
        ? computeProgressiveTax(base, taxBrackets)
        : computeAmountDue(base, param.rate, param.ceiling);
    const dueDate = computeDueDate(cmd.periodYear, periodMonth, param.periodicity, param.dueDay);

    const existing = await this.declarations.findByNaturalKey(
      organizationId,
      cmd.taxCode,
      cmd.periodYear,
      periodMonth,
    );

    if (existing) {
      this.assertEditable(existing);
      return this.declarations.update(existing, {
        baseAmount: base,
        rate: param.rate,
        amountDue,
        dueDate,
        comment: cmd.comment ?? existing.comment,
      });
    }

    return this.declarations.create({
      organizationId,
      taxCode: cmd.taxCode,
      label: param.label,
      periodYear: cmd.periodYear,
      periodMonth,
      baseAmount: base,
      rate: param.rate,
      amountDue,
      dueDate,
      chargeAccount: param.chargeAccount,
      liabilityAccount: param.liabilityAccount,
      comment: cmd.comment ?? null,
      createdById: cmd.createdById ?? null,
    });
  }

  /**
   * Génère une déclaration en DÉRIVANT automatiquement la base depuis la
   * comptabilité validée de la période (selon le `base_kind` du paramètre).
   * Si le `base_kind` est `custom`, la base auto vaut 0 — saisir manuellement
   * (ex. patente). `baseOverride` force une base explicite si fourni.
   */
  async generateAuto(
    organizationId: TenantId,
    cmd: Omit<GenerateDeclarationCommand, 'baseAmount'> & { baseOverride?: string },
  ): Promise<FiscalDeclarationEntity> {
    const periodMonth = cmd.periodMonth ?? null;
    const onDate = `${cmd.periodYear}-${String(periodMonth ?? 1).padStart(2, '0')}-01`;

    const param = await this.params.findEffective(organizationId, cmd.taxCode, onDate);
    if (!param) {
      throw new AppException(ERROR_CODES.FISCAL_NO_RATE_FOR_PERIOD, {
        message: `Aucun paramètre actif pour ${cmd.taxCode} à la date ${onDate}`,
        details: { taxCode: cmd.taxCode, onDate },
      });
    }

    const baseAmount =
      cmd.baseOverride ??
      (await this.baseService.computeBase(
        organizationId,
        param.baseKind,
        cmd.periodYear,
        periodMonth,
      ));

    return this.generate(organizationId, {
      taxCode: cmd.taxCode,
      periodYear: cmd.periodYear,
      periodMonth,
      baseAmount,
      comment: cmd.comment,
      createdById: cmd.createdById,
    });
  }

  /**
   * Déverse l'échéance d'une déclaration dans le budget de trésorerie : crée
   * (ou met à jour) une ligne budgétaire TRESO scénario BR (prévisionnel)
   * au mois de la date limite, montant NÉGATIF (décaissement), imputée au
   * compte de dette (44x/43x). Réalise la « boucle vertueuse » fiscal →
   * trésorerie. Le compte de dette sert de clé : deux impôts au même compte
   * et même échéance partagent la ligne (approximation prévisionnelle).
   */
  async spillToTreasury(
    id: string,
    organizationId: TenantId,
    actorUserId: string | null,
  ): Promise<FiscalDeclarationEntity> {
    const decl = await this.findById(id, organizationId);
    const dueYear = Number(decl.dueDate.slice(0, 4));
    const dueMonth = Number(decl.dueDate.slice(5, 7));
    const account = decl.liabilityAccount ?? '521';
    const outflow = decl.amountDue.startsWith('-') ? decl.amountDue : `-${decl.amountDue}`;

    await this.budgetLines.upsert(organizationId, {
      fiscalYear: dueYear,
      periodMonth: dueMonth,
      budgetType: 'TRESO',
      scenario: 'BR',
      accountCode: account,
      accountLabel: `Échéance ${decl.taxCode}`,
      amount: outflow,
      currency: decl.currency,
      exchangeRate: '1',
      comment: `Décaissement ${decl.taxCode} période ${decl.periodYear}${
        decl.periodMonth ? `-${String(decl.periodMonth).padStart(2, '0')}` : ''
      }`,
      createdById: actorUserId,
    });

    return decl;
  }

  async update(
    id: string,
    organizationId: TenantId,
    cmd: UpdateDeclarationCommand,
  ): Promise<FiscalDeclarationEntity> {
    const decl = await this.findById(id, organizationId);
    this.assertEditable(decl);

    // Si la base change, on recalcule le montant dû au taux figé de la
    // déclaration (le taux n'évolue pas après génération).
    const amountDue =
      cmd.baseAmount !== undefined ? computeAmountDue(cmd.baseAmount, decl.rate, null) : undefined;

    return this.declarations.update(decl, {
      baseAmount: cmd.baseAmount,
      amountDue,
      reference: cmd.reference,
      justificatifUrl: cmd.justificatifUrl,
      comment: cmd.comment,
    });
  }

  async transition(
    id: string,
    organizationId: TenantId,
    targetStatus: FiscalDeclarationStatus,
    validatedById?: string | null,
  ): Promise<FiscalDeclarationEntity> {
    const decl = await this.findById(id, organizationId);
    const allowed = FISCAL_STATUS_TRANSITIONS[decl.status];
    if (!allowed.includes(targetStatus)) {
      throw new AppException(ERROR_CODES.FISCAL_DECLARATION_INVALID_TRANSITION, {
        message: `Transition ${decl.status} → ${targetStatus} non autorisée`,
        details: { from: decl.status, to: targetStatus, allowed },
      });
    }
    return this.declarations.update(decl, {
      status: targetStatus,
      validatedById: targetStatus === 'depose' ? (validatedById ?? null) : decl.validatedById,
    });
  }

  /** Une déclaration déposée/payée/annulée n'est plus recalculable. */
  private assertEditable(decl: FiscalDeclarationEntity): void {
    if (decl.status !== 'a_deposer') {
      throw new AppException(ERROR_CODES.FISCAL_DECLARATION_INVALID_TRANSITION, {
        message: `Déclaration au statut ${decl.status} : recalcul interdit`,
        details: { id: decl.id, status: decl.status },
      });
    }
  }
}
