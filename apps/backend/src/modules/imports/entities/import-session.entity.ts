import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { ImportSessionStatus, ImportSourceType } from '../types/import-status';
import { ImportFileEntity } from './import-file.entity';
import { ImportStagingEntryEntity } from './import-staging-entry.entity';

/**
 * `ImportSessionEntity` — voir migration 0015.
 *
 * Une session = une tentative d'import par un utilisateur pour une
 * organisation. Elle agrège un ou plusieurs fichiers (`files`) et les
 * lignes staging issues du parsing (`stagingEntries`). Le statut suit
 * la machine d'état décrite dans `types/import-status.ts`.
 *
 * `companyId` et `fiscalYear` sont déclarés en `text` nullable car
 * `Company` / `FiscalYear` ne sont pas encore matérialisés (Module 2
 * vague 2). Ils permettent au Module 3 de stocker l'intention sans
 * bloquer sur le Module 2.
 */
@Entity({ name: 'import_sessions' })
@Index('ix_import_sessions_org_status_created', ['organizationId', 'status', 'createdAt'])
@Index('ix_import_sessions_org_created_by', ['organizationId', 'createdById'])
export class ImportSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'company_id', type: 'text', nullable: true })
  companyId!: string | null;

  @Column({ name: 'fiscal_year', type: 'text', nullable: true })
  fiscalYear!: string | null;

  @Column({ type: 'text', nullable: true })
  label!: string | null;

  @Column({ name: 'source_type', type: 'text' })
  sourceType!: ImportSourceType;

  @Column({ type: 'text', default: 'draft' })
  status!: ImportSessionStatus;

  @Column({ name: 'total_lines', type: 'integer', default: 0 })
  totalLines!: number;

  @Column({ name: 'error_lines', type: 'integer', default: 0 })
  errorLines!: number;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdById!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  createdBy!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ImportFileEntity, (file) => file.session)
  files!: ImportFileEntity[];

  @OneToMany(() => ImportStagingEntryEntity, (entry) => entry.session)
  stagingEntries!: ImportStagingEntryEntity[];
}
