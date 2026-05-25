import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { CurrencyEntity } from '../entities/currency.entity';
import {
  CurrencyRepository,
  type CreateCurrencyInput,
  type UpdateCurrencyInput,
} from '../repositories/currency.repository';
import { DEFAULT_CURRENCIES } from '../types/currency.types';

/**
 * `CurrenciesService` — CRUD du catalogue ISO 4217 par organisation.
 *
 * Comportement clé :
 *   - `seedDefaults` est invoqué à la création d'une organisation pour
 *     pré-seeder le catalogue avec XOF + 8 devises courantes
 *     (cf. DEFAULT_CURRENCIES). Idempotent : un second appel ignore
 *     les codes déjà présents.
 *   - Les codes sont normalisés en majuscules au stockage.
 *   - `findByCodeOrThrow` est le pattern d'usage standard pour les
 *     services qui doivent résoudre un code humain en UUID
 *     (ex: `ExchangeRatesService.create`).
 *
 * Wave 1 : pas de soft-delete. Désactivation via `isActive=false`.
 */
@Injectable()
export class CurrenciesService {
  private readonly logger = new Logger(CurrenciesService.name);

  constructor(private readonly currencyRepo: CurrencyRepository) {}

  async seedDefaults(organizationId: TenantId, manager: EntityManager): Promise<void> {
    assertTenantId(organizationId);
    for (const seed of DEFAULT_CURRENCIES) {
      await this.currencyRepo.create(
        {
          organizationId,
          code: seed.code,
          label: seed.label,
          decimalPlaces: seed.decimalPlaces,
          symbol: seed.symbol,
        },
        manager,
      );
    }
    this.logger.log(
      `Seeded ${DEFAULT_CURRENCIES.length} default currencies for org ${organizationId}`,
    );
  }

  async listForOrg(
    organizationId: TenantId,
    options: { activeOnly?: boolean } = {},
  ): Promise<CurrencyEntity[]> {
    assertTenantId(organizationId);
    return this.currencyRepo.listByOrganization(organizationId, options);
  }

  async findByCode(organizationId: TenantId, code: string): Promise<CurrencyEntity | null> {
    assertTenantId(organizationId);
    return this.currencyRepo.findByCode(organizationId, code);
  }

  async findByCodeOrThrow(organizationId: TenantId, code: string): Promise<CurrencyEntity> {
    const currency = await this.findByCode(organizationId, code);
    if (!currency) {
      throw new NotFoundException(`Currency '${code.toUpperCase()}' not found.`);
    }
    return currency;
  }

  async create(
    organizationId: TenantId,
    input: Omit<CreateCurrencyInput, 'organizationId'>,
  ): Promise<CurrencyEntity> {
    assertTenantId(organizationId);
    const existing = await this.currencyRepo.findByCode(organizationId, input.code);
    if (existing) {
      throw new ConflictException(`Currency '${input.code.toUpperCase()}' already exists.`);
    }
    return this.currencyRepo.create({ ...input, organizationId });
  }

  async update(
    id: string,
    organizationId: TenantId,
    patch: UpdateCurrencyInput,
  ): Promise<CurrencyEntity> {
    assertTenantId(organizationId);
    const existing = await this.currencyRepo.findById(id, organizationId);
    if (!existing) {
      throw new NotFoundException(`Currency '${id}' not found in this organization.`);
    }
    return this.currencyRepo.update(id, organizationId, patch);
  }
}
