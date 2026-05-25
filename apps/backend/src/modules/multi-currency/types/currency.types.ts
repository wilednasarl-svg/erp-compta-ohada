/**
 * Module 16 — Multi-devises (gestion des taux de change).
 *
 * Base monétaire : XOF (Franc CFA UEMOA, ISO 4217). Toutes les
 * comptabilités OHADA en zone UEMOA tiennent leurs livres en XOF.
 * Les taux sont stockés sous la forme : `1 currency_from = N currency_to`.
 *
 * Source par défaut des taux : BCEAO (cotation de référence UEMOA).
 * En wave 1, ils sont saisis manuellement via le controller ; le
 * scheduler de fetch BCEAO quotidien viendra en wave 2.
 */

/** Direction et précédence d'une cotation. */
export type RateSource = 'manual' | 'bceao' | 'ecb' | 'imported';

export const RATE_SOURCES: ReadonlyArray<RateSource> = ['manual', 'bceao', 'ecb', 'imported'];

/** Devise stockée dans le catalogue de l'organisation. */
export interface CurrencySeed {
  /** Code ISO 4217 (3 lettres majuscules). */
  readonly code: string;
  /** Libellé humain (ex. "Franc CFA UEMOA"). */
  readonly label: string;
  /** Nombre de décimales d'affichage (ISO 4217 minor unit exponent). */
  readonly decimalPlaces: 0 | 2 | 3;
  /** Symbole d'affichage (ex. "FCFA", "€", "$"). Indicatif. */
  readonly symbol: string | null;
}

/**
 * Devises pré-seedées à la création d'une organisation OHADA.
 *
 * - XOF : devise locale (CFA UEMOA — 8 pays dont la Côte d'Ivoire).
 * - EUR : ancrage fixe BCEAO (1 EUR = 655.957 XOF, parité Bretton Woods
 *   héritée). Référence majeure pour la zone CFA.
 * - USD : référence commerce international.
 * - GBP / CNY / CHF / CAD : devises commerciales courantes export.
 *
 * Cette liste est volontairement courte : une organisation peut
 * ajouter d'autres devises ISO 4217 via `CurrenciesController.create`.
 */
export const DEFAULT_CURRENCIES: ReadonlyArray<CurrencySeed> = [
  { code: 'XOF', label: 'Franc CFA UEMOA', decimalPlaces: 0, symbol: 'FCFA' },
  { code: 'EUR', label: 'Euro', decimalPlaces: 2, symbol: '€' },
  { code: 'USD', label: 'Dollar US', decimalPlaces: 2, symbol: '$' },
  { code: 'GBP', label: 'Livre sterling', decimalPlaces: 2, symbol: '£' },
  { code: 'CNY', label: 'Yuan chinois', decimalPlaces: 2, symbol: '¥' },
  { code: 'CHF', label: 'Franc suisse', decimalPlaces: 2, symbol: 'CHF' },
  { code: 'CAD', label: 'Dollar canadien', decimalPlaces: 2, symbol: 'C$' },
  { code: 'MAD', label: 'Dirham marocain', decimalPlaces: 2, symbol: 'DH' },
  { code: 'NGN', label: 'Naira nigérian', decimalPlaces: 2, symbol: '₦' },
];

/** Parité fixe BCEAO (1 EUR = 655.957 XOF), invariante depuis 1999. */
export const EUR_XOF_FIXED_RATE = '655.957';

/** Validation regex ISO 4217 : 3 lettres majuscules. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
