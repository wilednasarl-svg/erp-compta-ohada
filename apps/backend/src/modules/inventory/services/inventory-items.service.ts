import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import { InventoryItemEntity } from '../entities/inventory-item.entity';
import {
  InventoryItemRepository,
  type CreateInventoryItemInput,
  type UpdateInventoryItemInput,
} from '../repositories/inventory-item.repository';
import type { StockFamily } from '../types/inventory.types';

/**
 * `InventoryItemsService` — CRUD du registre des articles de stock.
 *
 * Garde-fous :
 *   - les 3 comptes (stock / purchase / sale) sont vérifiés appartenir
 *     au tenant via `OrganizationAccountRepository.findById` — cross-
 *     tenant impossible (404).
 *   - le `code` est normalisé en MAJ avant stockage (cohérent avec
 *     `Module 16 currencies`).
 *   - pas de soft-delete — désactivation via `status='archived'`.
 *
 * Compteurs (`currentQty`, `currentCmp`) maintenus par
 * `InventoryMovementsService` après chaque mouvement validé.
 */
@Injectable()
export class InventoryItemsService {
  constructor(
    private readonly itemsRepo: InventoryItemRepository,
    private readonly accountsRepo: OrganizationAccountRepository,
  ) {}

  async listForOrg(
    organizationId: TenantId,
    options: { activeOnly?: boolean; family?: StockFamily } = {},
  ): Promise<InventoryItemEntity[]> {
    assertTenantId(organizationId);
    return this.itemsRepo.listByOrganization(organizationId, options);
  }

  async findById(id: string, organizationId: TenantId): Promise<InventoryItemEntity> {
    assertTenantId(organizationId);
    const item = await this.itemsRepo.findById(id, organizationId);
    if (!item) {
      throw new NotFoundException(`Inventory item '${id}' not found in this organization.`);
    }
    return item;
  }

  async create(
    organizationId: TenantId,
    input: Omit<CreateInventoryItemInput, 'organizationId'>,
    actorId: string,
  ): Promise<InventoryItemEntity> {
    assertTenantId(organizationId);

    const existing = await this.itemsRepo.findByCode(organizationId, input.code);
    if (existing) {
      throw new ConflictException(
        `Inventory item code '${input.code.toUpperCase()}' already exists in this organization.`,
      );
    }

    // Verify the three account references belong to this tenant. Same
    // pattern as Module 12 (AssetsService.resolveAccountCode) — turning
    // a cross-tenant ID into a NotFound, never a leak.
    await this.assertAccountInTenant(input.stockAccountId, organizationId, 'stockAccountId');
    await this.assertAccountInTenant(
      input.purchaseAccountId,
      organizationId,
      'purchaseAccountId',
    );
    if (input.saleAccountId) {
      await this.assertAccountInTenant(input.saleAccountId, organizationId, 'saleAccountId');
    }

    return this.itemsRepo.create({
      ...input,
      organizationId,
      createdById: actorId,
    });
  }

  async update(
    id: string,
    organizationId: TenantId,
    patch: UpdateInventoryItemInput,
  ): Promise<InventoryItemEntity> {
    assertTenantId(organizationId);
    await this.findById(id, organizationId); // 404 guard

    if (patch.stockAccountId) {
      await this.assertAccountInTenant(patch.stockAccountId, organizationId, 'stockAccountId');
    }
    if (patch.purchaseAccountId) {
      await this.assertAccountInTenant(
        patch.purchaseAccountId,
        organizationId,
        'purchaseAccountId',
      );
    }
    if (patch.saleAccountId) {
      await this.assertAccountInTenant(patch.saleAccountId, organizationId, 'saleAccountId');
    }

    return this.itemsRepo.update(id, organizationId, patch);
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private async assertAccountInTenant(
    accountId: string,
    organizationId: TenantId,
    field: string,
  ): Promise<void> {
    const account = await this.accountsRepo.findById(accountId, organizationId);
    if (!account) {
      throw new NotFoundException(
        `${field} '${accountId}' not found in this organization's chart of accounts.`,
      );
    }
  }
}
