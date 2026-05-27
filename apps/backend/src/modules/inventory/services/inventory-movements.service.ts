import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { EntriesService, type CreateLineInput } from '../../journals/services/entries.service';
import { InventoryItemEntity } from '../entities/inventory-item.entity';
import { InventoryMovementEntity } from '../entities/inventory-movement.entity';
import { InventoryItemRepository } from '../repositories/inventory-item.repository';
import { InventoryLotsRepository } from '../repositories/inventory-lot.repository';
import {
  InventoryMovementRepository,
  type ListMovementsFilters,
} from '../repositories/inventory-movement.repository';
import type { MovementType } from '../types/inventory.types';
import {
  applyAdjustment,
  applyInventoryCount,
  applyPurchase,
  applySale,
  type ValuationResult,
} from './cmp-calculator';
import { consumeFromLots, type FifoLot } from './fifo-calculator';
import { InventoryItemsService } from './inventory-items.service';

export interface RecordMovementInput {
  readonly type: MovementType;
  readonly movementDate: string;
  readonly qty: string;
  readonly unitPrice?: string | null;
  readonly reference?: string | null;
  readonly description?: string | null;
}

export interface RecordMovementOptions {
  /**
   * Contexte d'audit transmis à `EntriesService.createDraft` pour la
   * génération automatique d'écriture (W4.2). Optionnel — si absent,
   * un ctx anonyme est utilisé (cohérent avec les jobs background).
   */
  readonly auditContext?: AuditContext;
}

export interface RecordMovementResult {
  readonly movement: InventoryMovementEntity;
  readonly item: InventoryItemEntity;
}

/**
 * Comptes SYSCOHADA appariés au compte de stock pour les contre-parties
 * automatiques (W4.2 — Tome 2 chap 14, App. 52) :
 *
 *   - purchase                       → C 6031 (variation stock marchandises)
 *   - sale                           → D 6031
 *   - adjustment / inventory_count + → C 7133 (variation stock — gain)
 *   - adjustment / inventory_count - → D 6031 (variation stock — perte)
 *
 * Mapping volontairement figé en TS (pas en DB) — un changement de plan
 * comptable ne casse pas les tables.
 */
const VARIATION_ACCOUNT_PURCHASE = '6031';
const VARIATION_ACCOUNT_SALE = '6031';
const VARIATION_ACCOUNT_GAIN = '7133';
const VARIATION_ACCOUNT_LOSS = '6031';
const DEFAULT_STOCK_ACCOUNT = '311';
const ACCOUNTING_JOURNAL_CODE = 'OD';

/**
 * `InventoryMovementsService` — enregistre un mouvement de stock dans
 * une transaction unique :
 *
 *   1. Lock l'item (SELECT ... FOR UPDATE) pour sérialiser les
 *      mouvements concurrents sur le même article.
 *   2. Applique la valorisation : CMP (formule pondérée) OU FIFO
 *      (consommation de lots) selon `item.valuationMethod`.
 *   3. Crée/met à jour les `inventory_lots` (purchase = nouveau lot,
 *      sale FIFO = consommation des plus anciens).
 *   4. INSERT du `inventory_movements` avec snapshot {qty_after, cmp_after}.
 *   5. UPDATE de `inventory_items.{currentQty, currentCmp}`.
 *   6. Si `item.accountCode` défini et type non-production, génère
 *      l'écriture comptable via `EntriesService.createDraft` puis
 *      patche `movement.journalEntryId`.
 *
 * Tout est dans la même transaction → soit tout réussit, soit rien
 * (sauf la génération d'écriture qui logue un warning sans bloquer).
 */
@Injectable()
export class InventoryMovementsService {
  private readonly logger = new Logger(InventoryMovementsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly itemsRepo: InventoryItemRepository,
    private readonly movementsRepo: InventoryMovementRepository,
    private readonly itemsService: InventoryItemsService,
    private readonly lotsRepo: InventoryLotsRepository,
    @Optional() private readonly entriesService: EntriesService | null = null,
  ) {}

  async recordMovement(
    organizationId: TenantId,
    itemId: string,
    input: RecordMovementInput,
    actorId: string,
    options: RecordMovementOptions = {},
  ): Promise<RecordMovementResult> {
    assertTenantId(organizationId);

    return this.dataSource.transaction(async (manager) => {
      const itemRepo = manager.getRepository(InventoryItemEntity);
      const item = await itemRepo
        .createQueryBuilder('i')
        .where('i.id = :id AND i.organization_id = :organizationId', {
          id: itemId,
          organizationId,
        })
        .setLock('pessimistic_write')
        .getOne();

      if (!item) {
        return this.itemsService.findById(itemId, organizationId).then(() => {
          throw new Error('unreachable');
        });
      }
      if (item.status !== 'active') {
        throw new BadRequestException(
          `Cannot record movement on archived item '${item.code}'.`,
        );
      }

      // ─── Valorisation : CMP ou FIFO ───────────────────────────────
      const state = { qty: item.currentQty, cmp: item.currentCmp };
      const { valuation, fifoTotalCost } = await this.computeValuation(
        organizationId,
        item.id,
        item.valuationMethod ?? 'cmp',
        state,
        input,
        manager,
      );

      // ─── Persiste le mouvement ────────────────────────────────────
      const movement = await this.movementsRepo.create(
        {
          organizationId,
          itemId: item.id,
          type: input.type,
          movementDate: input.movementDate,
          qty: String(input.qty),
          unitPrice: input.unitPrice ?? null,
          qtyAfter: valuation.qty,
          cmpAfter: valuation.cmp,
          movementValue: valuation.movementValue,
          reference: input.reference ?? null,
          description: input.description ?? null,
          createdById: actorId,
        },
        manager,
      );

      await this.itemsRepo.updateState(
        item.id,
        organizationId,
        { currentQty: valuation.qty, currentCmp: valuation.cmp },
        manager,
      );

      // ─── FIFO : créer le lot à l'achat ───────────────────────────
      if (
        input.type === 'purchase' &&
        item.valuationMethod === 'fifo' &&
        input.unitPrice !== null &&
        input.unitPrice !== undefined
      ) {
        await this.lotsRepo.create(
          {
            organizationId,
            inventoryItemId: item.id,
            entryDate: input.movementDate,
            initialQty: String(input.qty),
            unitCost: String(input.unitPrice),
            sourceMovementId: movement.id,
          },
          manager,
        );
      }

      // ─── Génère l'écriture comptable (W4.2 partie A) ─────────────
      const journalEntryId = await this.tryGenerateJournalEntry(
        organizationId,
        item,
        movement,
        input,
        valuation,
        fifoTotalCost,
        actorId,
        options.auditContext,
      );

      if (journalEntryId) {
        await manager
          .getRepository(InventoryMovementEntity)
          .update({ id: movement.id }, { journalEntryId });
        movement.journalEntryId = journalEntryId;
      }

      const refreshed = await itemRepo.findOneOrFail({
        where: { id: item.id, organizationId },
      });

      return { movement, item: refreshed };
    });
  }

  async list(
    organizationId: TenantId,
    filters: ListMovementsFilters = {},
  ): Promise<InventoryMovementEntity[]> {
    assertTenantId(organizationId);
    return this.movementsRepo.list(organizationId, filters);
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /**
   * Délègue à CMP ou FIFO selon `valuationMethod`. Pour FIFO sur sale,
   * consomme les lots et met à jour leur `remainingQty` en transaction.
   * Retourne le ValuationResult standard + le coût total FIFO si
   * applicable (utilisé pour le montant de l'écriture comptable).
   */
  private async computeValuation(
    organizationId: TenantId,
    itemId: string,
    method: 'cmp' | 'fifo',
    state: { qty: string; cmp: string },
    input: RecordMovementInput,
    manager: EntityManager,
  ): Promise<{ valuation: ValuationResult; fifoTotalCost: string | null }> {
    if (input.type === 'sale' && method === 'fifo') {
      const lots = await this.lotsRepo.listAvailable(organizationId, itemId, manager);
      const fifoLots: FifoLot[] = lots.map((l) => ({
        id: l.id,
        remainingQty: l.remainingQty,
        unitCost: l.unitCost,
      }));
      const result = consumeFromLots(fifoLots, input.qty);

      if (Number(result.remainingShortage) > 0) {
        throw new AppException(ERROR_CODES.INVENTORY_FIFO_INSUFFICIENT_STOCK, {
          message:
            `FIFO sale qty (${String(input.qty)}) exceeds available lots ` +
            `(shortage=${result.remainingShortage}).`,
          details: { shortage: result.remainingShortage, requested: String(input.qty) },
        });
      }

      // Update remaining_qty for each consumed lot.
      for (const line of result.consumed) {
        const matching = lots.find((l) => l.id === line.lotId);
        if (!matching) continue;
        const newRemaining = Number(matching.remainingQty) - Number(line.qty);
        await this.lotsRepo.updateRemainingQty(
          line.lotId,
          newRemaining.toFixed(4),
          manager,
        );
      }

      // Build a ValuationResult compatible with the CMP shape. Quantité
      // après sortie = qty courante - qty sortie. CMP inchangé (le snapshot
      // FIFO se trouve dans la décomposition `consumed`, gardée en lots).
      const qtyAfter = (Number(state.qty) - Number(input.qty)).toFixed(4);
      return {
        valuation: {
          qty: qtyAfter,
          cmp: Number(state.cmp).toFixed(4),
          movementValue: (-Number(result.totalCost)).toFixed(2),
        },
        fifoTotalCost: result.totalCost,
      };
    }

    return { valuation: this.computeCmp(state, input), fifoTotalCost: null };
  }

  private computeCmp(
    state: { qty: string; cmp: string },
    input: RecordMovementInput,
  ): ValuationResult {
    switch (input.type) {
      case 'purchase':
      case 'production':
        if (input.unitPrice === undefined || input.unitPrice === null) {
          throw new BadRequestException(
            `${input.type} movement requires a unitPrice.`,
          );
        }
        return applyPurchase(state, { qty: input.qty, unitPrice: input.unitPrice });
      case 'sale':
        return applySale(state, { qty: input.qty });
      case 'adjustment':
        return applyAdjustment(state, {
          deltaQty: input.qty,
          unitPrice: input.unitPrice ?? undefined,
        });
      case 'inventory_count':
        return applyInventoryCount(state, { physicalQty: input.qty });
    }
  }

  /**
   * W4.2 partie A — auto-génération de l'écriture comptable.
   *
   * Schéma SYSCOHADA (Tome 2 chap 14, App. 52) :
   *  - purchase           : D 311 (stock) / C 6031 (variation stock)
   *  - sale               : D 6031        / C 311
   *  - adjustment > 0     : D 311         / C 7133 (variation positive)
   *  - adjustment < 0     : D 6031        / C 311
   *  - inventory_count >  : D 311         / C 7133
   *  - inventory_count <  : D 6031        / C 311
   *
   * Skip si :
   *  - item.accountCode null (l'utilisateur n'a pas configuré le compte)
   *  - type === 'production' (à modéliser séparément en wave ultérieure)
   *  - EntriesService non câblé (tests / boot incomplet)
   *  - movementValue ≈ 0 (no-op comptable)
   *
   * En cas d'échec (compte introuvable, période fermée...), log warning
   * et retourne null — le mouvement de stock reste valide.
   */
  private async tryGenerateJournalEntry(
    organizationId: TenantId,
    item: InventoryItemEntity,
    movement: InventoryMovementEntity,
    input: RecordMovementInput,
    valuation: ValuationResult,
    fifoTotalCost: string | null,
    actorId: string,
    auditCtx: AuditContext | undefined,
  ): Promise<string | null> {
    if (!this.entriesService) return null;
    if (input.type === 'production') return null;
    if (!item.accountCode) {
      this.logger.warn(
        `Skipping journal entry for movement ${movement.id}: item ${item.code} has no accountCode.`,
      );
      return null;
    }

    const stockAccount = item.accountCode ?? DEFAULT_STOCK_ACCOUNT;
    const amount = this.computePostingAmount(input.type, valuation, fifoTotalCost);
    if (amount === null || amount <= 0.005) {
      return null;
    }

    const lines = this.buildEntryLines(input.type, stockAccount, amount, movement);
    if (lines.length === 0) return null;

    const ctx: AuditContext = auditCtx ?? {
      ipAddress: null,
      userAgent: null,
      userId: actorId,
      organizationId,
    };

    try {
      const entry = await this.entriesService.createDraft(
        organizationId,
        {
          journalCode: ACCOUNTING_JOURNAL_CODE,
          entryDate: input.movementDate,
          description: `Stock ${input.type} ${item.code}`.slice(0, 200),
          reference: movement.id,
          lines,
        },
        actorId,
        ctx,
      );
      return entry.id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to generate journal entry for movement ${movement.id}: ${msg}`,
      );
      return null;
    }
  }

  /**
   * Renvoie le montant positif à porter en débit/crédit de l'écriture.
   * Préférence : coût FIFO si fourni, sinon |movementValue|.
   */
  private computePostingAmount(
    type: MovementType,
    valuation: ValuationResult,
    fifoTotalCost: string | null,
  ): number | null {
    if (type === 'production') return null;
    if (fifoTotalCost !== null) return Math.abs(Number(fifoTotalCost));
    return Math.abs(Number(valuation.movementValue));
  }

  private buildEntryLines(
    type: MovementType,
    stockAccount: string,
    amount: number,
    movement: InventoryMovementEntity,
  ): CreateLineInput[] {
    const descBase = `Mvt stock ${movement.id.slice(0, 8)}`;
    switch (type) {
      case 'purchase':
        return [
          { accountCode: stockAccount, debit: amount, credit: 0, description: descBase },
          {
            accountCode: VARIATION_ACCOUNT_PURCHASE,
            debit: 0,
            credit: amount,
            description: descBase,
          },
        ];
      case 'sale':
        return [
          {
            accountCode: VARIATION_ACCOUNT_SALE,
            debit: amount,
            credit: 0,
            description: descBase,
          },
          { accountCode: stockAccount, debit: 0, credit: amount, description: descBase },
        ];
      case 'adjustment': {
        const delta = Number(movement.qty);
        if (delta > 0) {
          return [
            { accountCode: stockAccount, debit: amount, credit: 0, description: descBase },
            {
              accountCode: VARIATION_ACCOUNT_GAIN,
              debit: 0,
              credit: amount,
              description: descBase,
            },
          ];
        }
        return [
          {
            accountCode: VARIATION_ACCOUNT_LOSS,
            debit: amount,
            credit: 0,
            description: descBase,
          },
          { accountCode: stockAccount, debit: 0, credit: amount, description: descBase },
        ];
      }
      case 'inventory_count': {
        const movValue = Number(movement.movementValue);
        if (movValue > 0) {
          return [
            { accountCode: stockAccount, debit: amount, credit: 0, description: descBase },
            {
              accountCode: VARIATION_ACCOUNT_GAIN,
              debit: 0,
              credit: amount,
              description: descBase,
            },
          ];
        }
        return [
          {
            accountCode: VARIATION_ACCOUNT_LOSS,
            debit: amount,
            credit: 0,
            description: descBase,
          },
          { accountCode: stockAccount, debit: 0, credit: amount, description: descBase },
        ];
      }
      case 'production':
        return [];
    }
  }
}
