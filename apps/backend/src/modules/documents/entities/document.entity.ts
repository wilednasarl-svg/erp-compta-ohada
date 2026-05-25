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
import type { OcrStatus } from '../types/ocr-status';
import { DocumentEntryEntity } from './document-entry.entity';

/**
 * `DocumentEntity` — voir migration 0020.
 *
 * Central document store: every uploaded artifact attached to an
 * organization (invoice scan, contract, voucher, …). The actual bytes
 * live outside the database under the storage key produced by
 * `DocumentStorageService`; the row owns the metadata, content hash,
 * tags, OCR state and audit fields.
 *
 * Soft-delete: `deletedAt` / `deletedBy` are set in pair by
 * `DocumentsService.softDelete`. The row stays in the table so dependent
 * pivot rows (`document_entries`) remain navigable; list and get paths
 * filter on `deleted_at IS NULL`. A janitor (future wave) will reap
 * physical storage for documents older than the retention window.
 *
 * `tags` is stored as a JSONB array of strings. The frontend owns the
 * taxonomy in wave 1; a dedicated `document_tag_definitions` table can
 * be introduced later without altering this column.
 */
@Entity({ name: 'documents' })
@Index('ix_documents_org_created_at', ['organizationId', 'createdAt'])
@Index('ix_documents_org_sha256', ['organizationId', 'sha256Checksum'])
@Index('ix_documents_org_uploaded_by', ['organizationId', 'uploadedBy'])
@Index('ix_documents_org_ocr_status', ['organizationId', 'ocrStatus'])
export class DocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'text' })
  filename!: string;

  @Column({ name: 'mime_type', type: 'text' })
  mimeType!: string;

  /**
   * `bigint` is mapped to `string` by the pg driver to avoid silent
   * precision loss for values > 2^53. The service converts to `number`
   * at the boundary; with a 50 MB cap this is always safe.
   */
  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  @Column({ name: 'sha256_checksum', type: 'char', length: 64 })
  sha256Checksum!: string;

  @Column({ name: 'storage_key', type: 'text' })
  storageKey!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  tags!: string[];

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'ocr_status', type: 'text', default: 'pending' })
  ocrStatus!: OcrStatus;

  @Column({ name: 'ocr_text', type: 'text', nullable: true })
  ocrText!: string | null;

  /**
   * Average OCR confidence reported by the engine in [0, 1]. NULL
   * until OCR runs. Module 10 wave 2 — migration 0086.
   */
  @Column({
    name: 'ocr_confidence',
    type: 'decimal',
    precision: 3,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null): number | null => value,
      from: (value: string | number | null): number | null =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  ocrConfidence!: number | null;

  @Column({ name: 'ocr_processed_at', type: 'timestamptz', nullable: true })
  ocrProcessedAt!: Date | null;

  /**
   * Invoice metadata extracted from `ocr_text` by the regex-based
   * `MetadataExtractor`. Shape is `Partial<ExtractedInvoiceMetadata>`
   * (see `services/metadata-extractor.ts`). NULL until extraction runs.
   */
  @Column({ name: 'extracted_metadata', type: 'jsonb', nullable: true })
  extractedMetadata!: Record<string, unknown> | null;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploaded_by' })
  uploader!: UserEntity;

  @Column({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_by', type: 'uuid', nullable: true })
  deletedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => DocumentEntryEntity, (link) => link.document)
  entryLinks!: DocumentEntryEntity[];
}
