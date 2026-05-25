import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { AccountType, NormalBalance } from '../types/accounting-system';
import { ReferenceAccountEntity } from './reference-account.entity';

/**
 * `OrganizationAccountEntity` — un compte du plan comptable
 * personnalisé d'une organisation. Voir migration 0013.
 *
 * `parent` est self-référencé : un sous-compte `4111` aura comme
 * parent le compte `411`, lui-même enfant de `41`, lui-même enfant de
 * `4`. La règle "code commence par le code du parent et est plus long"
 * est enforced par `ChartOfAccountsService.createCustomAccount` (avec
 * un test e2e à venir au Module 3 — section 10.4).
 *
 * `referenceAccount` (FK `reference_chart_accounts.id`) :
 *   - non-null → le compte est une copie du référentiel SYSCOHADA
 *     officiel. Immuable côté API (sauf `label` + `isActive`),
 *     indélétable, ne peut pas être enrichi de propriétés métier
 *     normées (la classe / le sens normal viennent de la référence).
 *   - null → le compte est custom à cette organisation. Modifiable,
 *     supprimable si feuille sans écriture.
 */
@Entity({ name: 'organization_chart_accounts' })
@Unique('uq_organization_chart_accounts_org_code', ['organizationId', 'code'])
@Index('ix_organization_chart_accounts_org_class', ['organizationId', 'class'])
@Index('ix_organization_chart_accounts_org_parent', ['organizationId', 'parentId'])
@Index('ix_organization_chart_accounts_org_active', ['organizationId', 'isActive'])
export class OrganizationAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
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
   * `is_opposing = true` → compte au sens normal opposé à sa classe
   * (Tome 1 OHADA, G02). Hérité du `referenceAccount.isOpposing` lors
   * du clone du plan à la création de l'organisation, et backfillé
   * par préfixe de code pour les comptes custom (un 4912XXX reste
   * une dépréciation client même sans ligne de référence).
   *
   * Sous-classes concernées : 29x, 39x, 49x, 59x, 109, 121, 129, 409.
   * Voir `ReferenceAccountEntity.isOpposing` et migration 0090.
   */
  @Column({ type: 'boolean', name: 'is_opposing', default: false })
  isOpposing!: boolean;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => OrganizationAccountEntity, (account) => account.children, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'parent_id' })
  parent!: OrganizationAccountEntity | null;

  @OneToMany(() => OrganizationAccountEntity, (account) => account.parent)
  children!: OrganizationAccountEntity[];

  @Column({ name: 'reference_account_id', type: 'uuid', nullable: true })
  referenceAccountId!: string | null;

  @ManyToOne(() => ReferenceAccountEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reference_account_id' })
  referenceAccount!: ReferenceAccountEntity | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
