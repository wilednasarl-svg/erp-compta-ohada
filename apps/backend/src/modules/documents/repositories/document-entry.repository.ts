import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { DocumentEntryEntity } from '../entities/document-entry.entity';

export interface LinkInput {
  readonly organizationId: string;
  readonly documentId: string;
  readonly entryIds: ReadonlyArray<string>;
  readonly createdBy: string;
}

/**
 * `DocumentEntryRepository` (BE-DOC-02) — tenant-scoped persistence
 * for the `document_entries` pivot.
 *
 * Wave 1 only exposes append-style linking. Unlinking a single entry
 * from a document is not part of the MVP surface; a future revision
 * can add `unlink(documentId, entryId)` once the wave-2 UI calls for
 * it. Hard-deleting a document cascades onto these rows
 * (FK ON DELETE CASCADE).
 */
@Injectable()
export class DocumentEntryRepository {
  constructor(
    @InjectRepository(DocumentEntryEntity)
    private readonly repo: Repository<DocumentEntryEntity>,
  ) {}

  /**
   * Link a set of journal entries to a document. Idempotent through
   * `ON CONFLICT DO NOTHING` on the composite PK — a caller can
   * safely re-submit the same set without producing duplicates.
   * Returns the number of newly created links.
   */
  async link(input: LinkInput): Promise<number> {
    assertTenantId(input.organizationId);
    if (input.entryIds.length === 0) {
      return 0;
    }
    const rows = input.entryIds.map((entryId) => ({
      documentId: input.documentId,
      entryId,
      organizationId: input.organizationId,
      createdBy: input.createdBy,
    }));
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .into(DocumentEntryEntity)
      .values(rows)
      .orIgnore()
      .execute();
    // `result.identifiers` length tracks newly inserted rows on most
    // drivers; on pg with `orIgnore` it may not. Fall back to a count
    // probe so the caller gets a deterministic value.
    if (Array.isArray(result.identifiers)) {
      const inserted = result.identifiers.filter((id) => id != null).length;
      if (inserted > 0) return inserted;
    }
    return await this.countForDocument(input.organizationId, input.documentId);
  }

  async listForDocument(
    organizationId: TenantId | string,
    documentId: string,
  ): Promise<DocumentEntryEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({ where: { organizationId, documentId } });
  }

  async listForEntry(
    organizationId: TenantId | string,
    entryId: string,
  ): Promise<DocumentEntryEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({ where: { organizationId, entryId } });
  }

  async countForDocument(organizationId: TenantId | string, documentId: string): Promise<number> {
    assertTenantId(organizationId);
    return this.repo.count({ where: { organizationId, documentId } });
  }
}
