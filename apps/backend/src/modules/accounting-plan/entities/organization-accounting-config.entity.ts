import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { AccountingSystem } from '../types/accounting-system';

/**
 * `OrganizationAccountingConfigEntity` — table 1-1 avec
 * `organizations`. Voir migration 0012.
 *
 * Le champ `system` est figé à la création (cf. design D2). Aucune
 * méthode applicative ne l'expose en update — le seul chemin de
 * modification est une migration comptable formelle qui retraite
 * l'historique. Le schéma DB ne contraint pas la mutation au niveau
 * SQL (pour permettre cette future procédure), mais l'API ne le fait
 * jamais.
 */
@Entity({ name: 'organization_accounting_configs' })
export class OrganizationAccountingConfigEntity {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @OneToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  system!: AccountingSystem;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
