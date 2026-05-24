import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { AccountType, AccountingSystem, NormalBalance } from '../types/accounting-system';

/**
 * `ReferenceAccountEntity` — un compte du plan comptable de référence
 * SYSCOHADA AUDCIF. Voir `reference_chart_accounts` (migration 0011).
 *
 * Cette entité est **read-only côté code applicatif** : aucune API
 * d'écriture n'expose la table. Le seul chemin de modification est
 * une migration officielle (correction d'un libellé, ajout d'une
 * réforme OHADA). Les composants `OrganizationChartAccount` font
 * référence à cette table via `reference_account_id`.
 */
@Entity({ name: 'reference_chart_accounts' })
@Index('ix_reference_chart_accounts_class', ['class'])
export class ReferenceAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  code!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ type: 'smallint' })
  class!: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

  @Column({ type: 'text', name: 'account_type' })
  accountType!: AccountType;

  @Column({ type: 'char', length: 1, name: 'normal_balance' })
  normalBalance!: NormalBalance;

  // PG TEXT[] — mapped to a JS string array. TypeORM accepts `text` with
  // `array: true` and round-trips both directions correctly.
  @Column({ type: 'text', array: true, name: 'applicable_systems' })
  applicableSystems!: AccountingSystem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
