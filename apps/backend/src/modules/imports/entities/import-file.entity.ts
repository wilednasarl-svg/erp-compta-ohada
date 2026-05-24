import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { UserEntity } from '../../auth/entities/user.entity';
import type { ImportFileStatus } from '../types/import-status';
import { ImportSessionEntity } from './import-session.entity';
import { ImportStagingEntryEntity } from './import-staging-entry.entity';

/**
 * `ImportFileEntity` — voir migration 0016.
 *
 * Un fichier physique attaché à une session. Le contenu est stocké
 * hors-DB sous `IMPORT_STORAGE_DIR/<storagePath>` ; le row porte les
 * métadonnées (taille, MIME, checksum, statut de parsing).
 *
 * `sha256_checksum` permet (a) de détecter un upload doublon dans une
 * même session et (b) de vérifier l'intégrité si le fichier est déplacé
 * vers un stockage objet plus tard.
 */
@Entity({ name: 'import_files' })
@Index('ix_import_files_session', ['sessionId'])
@Index('ix_import_files_session_checksum', ['sessionId', 'sha256Checksum'])
export class ImportFileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => ImportSessionEntity, (session) => session.files, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session!: ImportSessionEntity;

  @Column({ name: 'original_name', type: 'text' })
  originalName!: string;

  @Column({ name: 'mime_type', type: 'text' })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  @Column({ name: 'sha256_checksum', type: 'char', length: 64 })
  sha256Checksum!: string;

  @Column({ name: 'storage_path', type: 'text' })
  storagePath!: string;

  @Column({ type: 'text', default: 'uploaded' })
  status!: ImportFileStatus;

  @Column({ name: 'parse_error', type: 'text', nullable: true })
  parseError!: string | null;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedById!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedBy!: UserEntity;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt!: Date;

  @OneToMany(() => ImportStagingEntryEntity, (entry) => entry.file)
  stagingEntries!: ImportStagingEntryEntity[];
}
