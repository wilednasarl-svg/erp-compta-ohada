import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { RateSource } from '../types/currency.types';
import { CurrencyEntity } from './currency.entity';

/**
 * `exchange_rates` row — voir migration 0064.
 *
 * Journal historique des taux de change. Convention de stockage :
 *
 *     1 unité de `from_currency` = `rate` unités de `to_currency`
 *
 * Exemple : pour 1 EUR = 655.957 XOF, on insère
 * (from='EUR', to='XOF', rate=655.957, rate_date='1999-01-01').
 *
 * Append-only : on ne modifie ni ne supprime un taux validé — pour
 * corriger, on insère un nouveau taux avec la même paire à une date
 * plus récente. L'API `getRateAtDate(pair, date)` lit le LAST rate
 * tel que `rate_date <= date`.
 *
 * Un taux est unique par (org, from, to, rate_date, source) : on peut
 * avoir le même jour un taux manuel + un taux BCEAO pour la même
 * paire, et la résolution `getRateAtDate` priorise la source choisie.
 */
@Entity({ name: 'exchange_rates' })
@Index(
  'uq_exchange_rates_org_pair_date_source',
  ['organizationId', 'fromCurrencyId', 'toCurrencyId', 'rateDate', 'source'],
  { unique: true },
)
@Index('ix_exchange_rates_org_pair_date', [
  'organizationId',
  'fromCurrencyId',
  'toCurrencyId',
  'rateDate',
])
export class ExchangeRateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'from_currency_id', type: 'uuid' })
  fromCurrencyId!: string;

  @ManyToOne(() => CurrencyEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'from_currency_id' })
  fromCurrency!: CurrencyEntity;

  @Column({ name: 'to_currency_id', type: 'uuid' })
  toCurrencyId!: string;

  @ManyToOne(() => CurrencyEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'to_currency_id' })
  toCurrency!: CurrencyEntity;

  @Column({ name: 'rate_date', type: 'date' })
  rateDate!: string;

  /**
   * NUMERIC(20,10) — permet une parité allant de 1e-10 à 1e10 avec
   * 10 décimales. Suffit pour toutes les paires majeures et exotiques.
   */
  @Column({ type: 'numeric', precision: 20, scale: 10 })
  rate!: string;

  @Column({ type: 'text', default: 'manual' })
  source!: RateSource;

  /**
   * Référence externe optionnelle (URL BCEAO, batch_id d'import, etc.)
   * Aide à la traçabilité ; non normalisé exprès.
   */
  @Column({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
