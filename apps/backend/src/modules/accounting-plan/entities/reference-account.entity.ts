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

  /**
   * `is_opposing = true` → le compte a un sens normal **opposé** à
   * celui de sa classe parente (Tome 1 OHADA, gap G02). Son solde
   * vient EN DÉDUCTION du poste au Bilan, jamais en addition.
   *
   * Sous-classes / comptes concernés :
   *   - 29x : dépréciations d'immobilisations (déduisent l'actif immo)
   *   - 39x : dépréciations de stocks
   *   - 49x : dépréciations de tiers (ex. 4912 sur clients douteux)
   *   - 59x : dépréciations de placements
   *   - 109 : capital souscrit non appelé (déduit le capital)
   *   - 121 : report à nouveau débiteur
   *   - 129 : résultat déficitaire
   *   - 409 : fournisseurs débiteurs (avances/acomptes versés)
   *
   * Exemple : une dépréciation 4912 avec solde créditeur de 50 000
   * FCFA vient en déduction du poste actif "Clients" et ne forme
   * jamais une dette côté passif.
   *
   * Voir migration 0090_add_opposing_accounts.
   */
  @Column({ type: 'boolean', name: 'is_opposing', default: false })
  isOpposing!: boolean;

  // PG TEXT[] — mapped to a JS string array. TypeORM accepts `text` with
  // `array: true` and round-trips both directions correctly.
  @Column({ type: 'text', array: true, name: 'applicable_systems' })
  applicableSystems!: AccountingSystem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
