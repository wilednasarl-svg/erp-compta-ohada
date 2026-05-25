import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ExchangeRateEntity } from '../entities/exchange-rate.entity';
import {
  ExchangeRateRepository,
  type ListRatesFilters,
} from '../repositories/exchange-rate.repository';
import type { RateSource } from '../types/currency.types';
import { CurrenciesService } from './currencies.service';
import { convertAmount, type FxConvertResult } from './fx-converter';

export interface PostManualRateInput {
  readonly fromCurrencyCode: string;
  readonly toCurrencyCode: string;
  readonly rateDate: string;
  readonly rate: string;
  readonly source?: RateSource;
  readonly sourceRef?: string | null;
  readonly actorId?: string | null;
}

export interface ConvertInput {
  readonly amount: string;
  readonly fromCurrencyCode: string;
  readonly toCurrencyCode: string;
  /** Defaults to today (UTC) when omitted. */
  readonly asOfDate?: string;
}

/**
 * `ExchangeRatesService` — gestion des taux de change + conversion.
 *
 * - `postRate` : insère un taux manuel (rejette le duplicate exact
 *   sur la clé d'unicité (org, from, to, date, source)).
 * - `getRateAtDate` : retourne le dernier taux disponible pour la paire
 *   à la date donnée, avec un fallback "rate inverse" (si EUR→XOF
 *   n'existe pas mais XOF→EUR oui, on inverse).
 * - `convert` : compose `getRateAtDate` + le converter pur.
 *
 * Wave 1 : pas de scheduler BCEAO, pas de cross-currency triangulaire
 * (si on demande USD→XOF et que seul USD→EUR + EUR→XOF existent,
 * on rejette plutôt que d'auto-composer — éviter les conversions
 * "magiques" qui surprennent en comptabilité).
 */
@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly ratesRepo: ExchangeRateRepository,
    private readonly currencies: CurrenciesService,
  ) {}

  async postRate(
    organizationId: TenantId,
    input: PostManualRateInput,
  ): Promise<ExchangeRateEntity> {
    assertTenantId(organizationId);

    if (input.fromCurrencyCode.toUpperCase() === input.toCurrencyCode.toUpperCase()) {
      throw new ConflictException(
        `Cannot post a rate for identical currencies (${input.fromCurrencyCode}).`,
      );
    }

    const [from, to] = await Promise.all([
      this.currencies.findByCodeOrThrow(organizationId, input.fromCurrencyCode),
      this.currencies.findByCodeOrThrow(organizationId, input.toCurrencyCode),
    ]);

    const source: RateSource = input.source ?? 'manual';
    const dup = await this.ratesRepo.findByExactKey(
      organizationId,
      from.id,
      to.id,
      input.rateDate,
      source,
    );
    if (dup) {
      throw new ConflictException(
        `A ${source} rate for ${from.code}→${to.code} on ${input.rateDate} already exists.`,
      );
    }

    return this.ratesRepo.create({
      organizationId,
      fromCurrencyId: from.id,
      toCurrencyId: to.id,
      rateDate: input.rateDate,
      rate: input.rate,
      source,
      sourceRef: input.sourceRef ?? null,
      createdById: input.actorId ?? null,
    });
  }

  async list(
    organizationId: TenantId,
    filters: ListRatesFilters & {
      fromCurrencyCode?: string;
      toCurrencyCode?: string;
    } = {},
  ): Promise<ExchangeRateEntity[]> {
    assertTenantId(organizationId);
    // `ListRatesFilters` is readonly to enforce immutability at the
    // repository boundary; we build the resolved struct as a writable
    // local then re-narrow when handing it back.
    const resolved: {
      -readonly [K in keyof ListRatesFilters]: ListRatesFilters[K];
    } = { ...filters };
    if (filters.fromCurrencyCode) {
      const cur = await this.currencies.findByCodeOrThrow(organizationId, filters.fromCurrencyCode);
      resolved.fromCurrencyId = cur.id;
    }
    if (filters.toCurrencyCode) {
      const cur = await this.currencies.findByCodeOrThrow(organizationId, filters.toCurrencyCode);
      resolved.toCurrencyId = cur.id;
    }
    return this.ratesRepo.list(organizationId, resolved);
  }

  /**
   * Returns the most relevant rate for the (from, to) pair as of the
   * given date — falls back to the inverse pair if the direct one
   * has no history yet (1 / inverseRate).
   *
   * Throws `NotFoundException` if neither direction has any rate.
   */
  async getRateAtDate(
    organizationId: TenantId,
    fromCode: string,
    toCode: string,
    asOfDate: string,
  ): Promise<{ rate: string; appliedSource: RateSource; inverted: boolean }> {
    assertTenantId(organizationId);
    if (fromCode.toUpperCase() === toCode.toUpperCase()) {
      return { rate: '1', appliedSource: 'manual', inverted: false };
    }

    const [from, to] = await Promise.all([
      this.currencies.findByCodeOrThrow(organizationId, fromCode),
      this.currencies.findByCodeOrThrow(organizationId, toCode),
    ]);

    const direct = await this.ratesRepo.findLatestForPair(organizationId, from.id, to.id, asOfDate);
    if (direct) {
      return { rate: direct.rate, appliedSource: direct.source, inverted: false };
    }

    const inverse = await this.ratesRepo.findLatestForPair(
      organizationId,
      to.id,
      from.id,
      asOfDate,
    );
    if (inverse) {
      const inverted = (1 / Number(inverse.rate)).toFixed(10);
      return { rate: inverted, appliedSource: inverse.source, inverted: true };
    }

    throw new NotFoundException(
      `No exchange rate found for ${from.code}→${to.code} as of ${asOfDate}.`,
    );
  }

  async convert(
    organizationId: TenantId,
    input: ConvertInput,
  ): Promise<
    FxConvertResult & {
      asOfDate: string;
      appliedSource: RateSource;
      inverted: boolean;
    }
  > {
    assertTenantId(organizationId);
    const asOfDate = input.asOfDate ?? new Date().toISOString().slice(0, 10);

    const to = await this.currencies.findByCodeOrThrow(organizationId, input.toCurrencyCode);

    const fromCode = input.fromCurrencyCode.toUpperCase();
    const toCode = input.toCurrencyCode.toUpperCase();

    const { rate, appliedSource, inverted } = await this.getRateAtDate(
      organizationId,
      fromCode,
      toCode,
      asOfDate,
    );

    const converted = convertAmount({
      amount: input.amount,
      fromCurrency: fromCode,
      toCurrency: toCode,
      rate: fromCode === toCode ? undefined : rate,
      toDecimalPlaces: to.decimalPlaces,
    });

    return { ...converted, asOfDate, appliedSource, inverted };
  }
}
