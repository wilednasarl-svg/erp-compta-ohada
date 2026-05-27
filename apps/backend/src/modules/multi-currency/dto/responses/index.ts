import { ApiProperty } from '@nestjs/swagger';

import { RATE_SOURCES, type RateSource } from '../../types/currency.types';

/**
 * Contrats Response du module multi-currency. Forme JSON strictement
 * préservée par rapport à la sérialisation TypeORM pré-DTO consommée
 * déjà par le frontend (currencies, taux de change, conversions).
 *
 * Pattern de référence : tva/dto/responses/.
 */

// ─── Currency ────────────────────────────────────────────────────────

export class CurrencyResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ description: 'Code ISO 4217 (3 lettres)', example: 'XOF' })
  code!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({
    description: 'Nombre de décimales d\'affichage (0|2|3)',
    enum: [0, 2, 3],
  })
  decimalPlaces!: 0 | 2 | 3;

  @ApiProperty({ nullable: true, type: String })
  symbol!: string | null;

  @ApiProperty({ type: Boolean })
  isActive!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

// ─── ExchangeRate ────────────────────────────────────────────────────

export class ExchangeRateResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  fromCurrencyId!: string;

  @ApiProperty({ format: 'uuid' })
  toCurrencyId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  rateDate!: string;

  @ApiProperty({ description: 'Taux NUMERIC(20,10) en string', example: '655.957' })
  rate!: string;

  @ApiProperty({ enum: RATE_SOURCES })
  source!: RateSource;

  @ApiProperty({ nullable: true, type: String })
  sourceRef!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  createdById!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

// ─── Conversion ──────────────────────────────────────────────────────

export class FxConversionResponse {
  @ApiProperty({ description: 'Montant converti (string DECIMAL)' })
  amount!: string;

  @ApiProperty({ description: 'Code ISO 4217 cible' })
  currency!: string;

  @ApiProperty({ description: 'Taux appliqué (string DECIMAL). 1.0 si identité.' })
  appliedRate!: string;

  @ApiProperty({ description: 'Date à laquelle le taux a été lu (YYYY-MM-DD)' })
  asOfDate!: string;

  @ApiProperty({ enum: RATE_SOURCES })
  appliedSource!: RateSource;

  @ApiProperty({
    description:
      'true si le taux a été inversé (paire inverse trouvée en base et 1/rate appliqué)',
    type: Boolean,
  })
  inverted!: boolean;
}

// ─── Enveloppes ──────────────────────────────────────────────────────

export class ListCurrenciesResponse {
  @ApiProperty({ type: () => [CurrencyResponse] })
  currencies!: CurrencyResponse[];
}

export class CurrencyEnvelopeResponse {
  @ApiProperty({ type: () => CurrencyResponse })
  currency!: CurrencyResponse;
}

export class ListExchangeRatesResponse {
  @ApiProperty({ type: () => [ExchangeRateResponse] })
  rates!: ExchangeRateResponse[];
}

export class ExchangeRateEnvelopeResponse {
  @ApiProperty({ type: () => ExchangeRateResponse })
  rate!: ExchangeRateResponse;
}

export class FxConversionEnvelopeResponse {
  @ApiProperty({ type: () => FxConversionResponse })
  conversion!: FxConversionResponse;
}
