import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { MappedRow } from '../types/mapping';
import type { ValidationError } from '../types/import-status';
import { ImportFileEntity } from './import-file.entity';
import { ImportSessionEntity } from './import-session.entity';

/**
 * `ImportStagingEntryEntity` — voir migration 0017.
 *
 * Une ligne du fichier source projetée dans le staging. `rawValues`
 * conserve les valeurs brutes (header → string) pour permettre de
 * re-jouer le mapping sans ré-upload. `mappedValues` porte la
 * projection canonique (`MappedRow`). `errors` est la liste des
 * findings de `ValidationService` ; `errors = []` signifie ligne
 * éligible au commit.
 *
 * Volumétrie : un fichier de 50 000 lignes produit 50 000 rows.
 */
@Entity({ name: 'import_staging_entries' })
@Index('ix_import_staging_entries_session_row', ['sessionId', 'rowNumber'])
@Index('ix_import_staging_entries_file_row', ['fileId', 'rowNumber'])
export class ImportStagingEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => ImportSessionEntity, (session) => session.stagingEntries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'session_id' })
  session!: ImportSessionEntity;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  @ManyToOne(() => ImportFileEntity, (file) => file.stagingEntries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file!: ImportFileEntity;

  @Column({ name: 'row_number', type: 'integer' })
  rowNumber!: number;

  @Column({ name: 'raw_values', type: 'jsonb', default: () => `'{}'::jsonb` })
  rawValues!: Record<string, string | null>;

  @Column({ name: 'mapped_values', type: 'jsonb', default: () => `'{}'::jsonb` })
  mappedValues!: MappedRow;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  errors!: ValidationError[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
