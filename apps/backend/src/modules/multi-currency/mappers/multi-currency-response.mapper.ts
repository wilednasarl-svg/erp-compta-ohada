import type { CurrencyEntity } from '../entities/currency.entity';
import type { ExchangeRateEntity } from '../entities/exchange-rate.entity';
import type { FxConvertResult } from '../services/fx-converter';
import type { RateSource } from '../types/currency.types';
import {
  type CurrencyEnvelopeResponse,
  type CurrencyResponse,
  type ExchangeRateEnvelopeResponse,
  type ExchangeRateResponse,
  type FxConversionEnvelopeResponse,
  type FxConversionResponse,
  type ListCurrenciesResponse,
  type ListExchangeRatesResponse,
} from '../dto/responses';

/**
 * Mappers purs entité TypeORM -> DTO de réponse pour le module
 * multi-currency. Forme JSON strictement préservée par rapport au
 * comportement pré-DTO.
 */

export function toCurrencyResponse(entity: CurrencyEntity): CurrencyResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    code: entity.code,
    label: entity.label,
    decimalPlaces: entity.decimalPlaces,
    symbol: entity.symbol,
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toExchangeRateResponse(entity: ExchangeRateEntity): ExchangeRateResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    fromCurrencyId: entity.fromCurrencyId,
    toCurrencyId: entity.toCurrencyId,
    rateDate: entity.rateDate,
    rate: entity.rate,
    source: entity.source,
    sourceRef: entity.sourceRef,
    createdById: entity.createdById,
    createdAt: entity.createdAt,
  };
}

export function toFxConversionResponse(
  result: FxConvertResult & {
    asOfDate: string;
    appliedSource: RateSource;
    inverted: boolean;
  },
): FxConversionResponse {
  return {
    amount: result.amount,
    currency: result.currency,
    appliedRate: result.appliedRate,
    asOfDate: result.asOfDate,
    appliedSource: result.appliedSource,
    inverted: result.inverted,
  };
}

// ─── Enveloppes ───────────────────────────────────────────────────────

export function toListCurrencies(entities: ReadonlyArray<CurrencyEntity>): ListCurrenciesResponse {
  return { currencies: entities.map(toCurrencyResponse) };
}

export function toCurrencyEnvelope(entity: CurrencyEntity): CurrencyEnvelopeResponse {
  return { currency: toCurrencyResponse(entity) };
}

export function toListExchangeRates(
  entities: ReadonlyArray<ExchangeRateEntity>,
): ListExchangeRatesResponse {
  return { rates: entities.map(toExchangeRateResponse) };
}

export function toExchangeRateEnvelope(entity: ExchangeRateEntity): ExchangeRateEnvelopeResponse {
  return { rate: toExchangeRateResponse(entity) };
}

export function toFxConversionEnvelope(
  result: FxConvertResult & {
    asOfDate: string;
    appliedSource: RateSource;
    inverted: boolean;
  },
): FxConversionEnvelopeResponse {
  return { conversion: toFxConversionResponse(result) };
}
