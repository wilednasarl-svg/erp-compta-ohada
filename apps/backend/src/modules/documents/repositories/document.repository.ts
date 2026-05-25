import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { DocumentEntity } from '../entities/document.entity';
import type { OcrStatus } from '../types/ocr-status';

/**
 * Filters consumed by `listForOrg`. All fields are optional and
 * combine with AND semantics. `tag` triggers a `tags ? :tag` JSONB
 * containment probe (the `documents.tags` column carries a GIN index
 * tuned for `jsonb_path_ops`).
 */
export interface DocumentListFilters {
  readonly tag?: string;
  readonly mimeType?: string;
  readonly uploadedBy?: string;
  readonly ocrStatus?: OcrStatus;
  readonly uploadedFrom?: Date;
  readonly uploadedTo?: Date;
  readonly linkedEntryIds?: ReadonlyArray<string>;
}

export interface PaginationOptions {
  readonly page: number;
  readonly pageSize: number;
}

export interface PaginatedDocuments {
  readonly rows: ReadonlyArray<DocumentEntity>;
  readonly total: number;
}

export interface CreateDocumentInput {
  readonly organizationId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256Checksum: string;
  readonly storageKey: string;
  readonly tags: ReadonlyArray<string>;
  readonly description: string | null;
  readonly uploadedBy: string;
}

/**
 * `DocumentRepository` (BE-DOC-02) — tenant-scoped persistence layer
 * for the `documents` table.
 *
 * Every public method takes `organizationId` and runs `assertTenantId`
 * before any query. Read paths additionally filter on
 * `deleted_at IS NULL` so soft-deleted rows never leak — call sites
 * that need the deleted rows (forensic / janitor) must use a dedicated
 * method that is intentionally NOT exposed in wave 1.
 */
@Injectable()
export class DocumentRepository {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly repo: Repository<DocumentEntity>,
  ) {}

  async findById(organizationId: TenantId | string, id: string): Promise<DocumentEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { id, organizationId, deletedAt: IsNull() },
    });
  }

  /**
   * Lookup including soft-deleted rows. Used only by maintenance paths
   * (storage GC, audit). Wave 1 keeps it private to the repository
   * surface — no service consumes it yet.
   */
  async findByIdIncludingDeleted(
    organizationId: TenantId | string,
    id: string,
  ): Promise<DocumentEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findActiveBySha256(
    organizationId: TenantId | string,
    sha256: string,
  ): Promise<DocumentEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, sha256Checksum: sha256, deletedAt: IsNull() },
    });
  }

  async createOne(input: CreateDocumentInput): Promise<DocumentEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: String(input.sizeBytes),
      sha256Checksum: input.sha256Checksum,
      storageKey: input.storageKey,
      tags: [...input.tags],
      description: input.description,
      ocrStatus: 'pending',
      ocrText: null,
      uploadedBy: input.uploadedBy,
      uploadedAt: new Date(),
      deletedAt: null,
      deletedBy: null,
    });
    return this.repo.save(entity);
  }

  /**
   * Soft-delete a document — sets the `deleted_at` / `deleted_by`
   * pair atomically. Idempotent: a second call on an already-deleted
   * row is a no-op (returns `false`).
   */
  async softDelete(
    organizationId: TenantId | string,
    id: string,
    deletedBy: string,
  ): Promise<boolean> {
    assertTenantId(organizationId);
    const now = new Date();
    const result = await this.repo
      .createQueryBuilder()
      .update(DocumentEntity)
      .set({ deletedAt: now, deletedBy })
      .where('id = :id', { id })
      .andWhere('organization_id = :organizationId', { organizationId })
      .andWhere('deleted_at IS NULL')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Persist OCR results + extracted metadata on a document row. Used
   * by `DocumentsService` after the OCR provider returns. All fields
   * are optional in the input — only the provided keys are written so
   * the caller can update OCR text without touching the extracted
   * metadata and vice-versa. Module 10 wave 2.
   */
  async updateOcrResult(
    organizationId: TenantId | string,
    id: string,
    patch: {
      readonly ocrStatus?: OcrStatus;
      readonly ocrText?: string | null;
      readonly ocrConfidence?: number | null;
      readonly ocrProcessedAt?: Date | null;
      readonly extractedMetadata?: Record<string, unknown> | null;
    },
  ): Promise<boolean> {
    assertTenantId(organizationId);
    const set: Record<string, unknown> = {};
    if (patch.ocrStatus !== undefined) set.ocrStatus = patch.ocrStatus;
    if (patch.ocrText !== undefined) set.ocrText = patch.ocrText;
    if (patch.ocrConfidence !== undefined) set.ocrConfidence = patch.ocrConfidence;
    if (patch.ocrProcessedAt !== undefined) set.ocrProcessedAt = patch.ocrProcessedAt;
    if (patch.extractedMetadata !== undefined) set.extractedMetadata = patch.extractedMetadata;
    if (Object.keys(set).length === 0) return false;

    const result = await this.repo
      .createQueryBuilder()
      .update(DocumentEntity)
      .set(set)
      .where('id = :id', { id })
      .andWhere('organization_id = :organizationId', { organizationId })
      .andWhere('deleted_at IS NULL')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async listForOrg(
    organizationId: TenantId | string,
    filters: DocumentListFilters,
    pagination: PaginationOptions,
  ): Promise<PaginatedDocuments> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('doc')
      .where('doc.organization_id = :organizationId', { organizationId })
      .andWhere('doc.deleted_at IS NULL');

    if (filters.mimeType !== undefined) {
      qb.andWhere('doc.mime_type = :mimeType', { mimeType: filters.mimeType });
    }
    if (filters.uploadedBy !== undefined) {
      qb.andWhere('doc.uploaded_by = :uploadedBy', { uploadedBy: filters.uploadedBy });
    }
    if (filters.ocrStatus !== undefined) {
      qb.andWhere('doc.ocr_status = :ocrStatus', { ocrStatus: filters.ocrStatus });
    }
    if (filters.uploadedFrom !== undefined && filters.uploadedTo !== undefined) {
      qb.andWhere('doc.uploaded_at BETWEEN :from AND :to', {
        from: filters.uploadedFrom,
        to: filters.uploadedTo,
      });
    } else if (filters.uploadedFrom !== undefined) {
      qb.andWhere('doc.uploaded_at >= :from', { from: filters.uploadedFrom });
    } else if (filters.uploadedTo !== undefined) {
      qb.andWhere('doc.uploaded_at <= :to', { to: filters.uploadedTo });
    }
    if (filters.tag !== undefined && filters.tag.length > 0) {
      // `tags ? :tag` — true when the JSONB array contains the literal
      // string. Backed by the GIN(jsonb_path_ops) index from
      // migration 0020.
      qb.andWhere(`doc.tags @> :tagArray::jsonb`, {
        tagArray: JSON.stringify([filters.tag]),
      });
    }
    if (filters.linkedEntryIds !== undefined && filters.linkedEntryIds.length > 0) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM document_entries link
           WHERE link.document_id = doc.id
             AND link.organization_id = doc.organization_id
             AND link.entry_id IN (:...entryIds)
         )`,
        { entryIds: filters.linkedEntryIds },
      );
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('doc.created_at', 'DESC')
      .skip((pagination.page - 1) * pagination.pageSize)
      .take(pagination.pageSize)
      .getMany();

    return { rows, total };
  }
}
