import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { JournalEntity } from '../entities/journal.entity';
import { JournalRepository } from '../repositories/journal.repository';
import { STANDARD_JOURNALS, type JournalKind } from '../types/journal.types';

export interface CreateCustomJournalInput {
  readonly code: string;
  readonly label: string;
  readonly kind: JournalKind;
  readonly defaultAccountId?: string | null;
}

@Injectable()
export class JournalsService {
  private static readonly MODULE = 'journals' as const;
  private readonly logger = new Logger(JournalsService.name);

  constructor(
    private readonly journalRepo: JournalRepository,
    private readonly audit: AuditTrailService,
  ) {}

  /**
   * Seed the 5 standard SYSCOHADA journals for a new organization.
   * Called inside the OrganizationsService.create transaction.
   */
  async seedStandardJournals(organizationId: TenantId, manager: EntityManager): Promise<void> {
    assertTenantId(organizationId);
    for (const j of STANDARD_JOURNALS) {
      await this.journalRepo.create(
        { organizationId, code: j.code, label: j.label, kind: j.kind },
        manager,
      );
    }
    this.logger.log(
      `Seeded ${STANDARD_JOURNALS.length} standard journals for org ${organizationId}`,
    );
  }

  async listForOrg(
    organizationId: TenantId,
    options: { activeOnly?: boolean } = {},
  ): Promise<JournalEntity[]> {
    assertTenantId(organizationId);
    return this.journalRepo.listByOrganization(organizationId, options);
  }

  async findByCode(organizationId: TenantId, code: string): Promise<JournalEntity> {
    assertTenantId(organizationId);
    const journal = await this.journalRepo.findByCode(organizationId, code);
    if (!journal) {
      throw new AppException(ERROR_CODES.JOURNAL_NOT_FOUND, {
        message: `Journal '${code}' not found.`,
      });
    }
    return journal;
  }

  async createCustom(
    organizationId: TenantId,
    input: CreateCustomJournalInput,
    actorId: string,
    ctx: AuditContext,
  ): Promise<JournalEntity> {
    assertTenantId(organizationId);
    const existing = await this.journalRepo.findByCode(organizationId, input.code);
    if (existing) {
      throw new AppException(ERROR_CODES.JOURNAL_CODE_TAKEN, {
        message: `A journal with code '${input.code}' already exists.`,
      });
    }

    const journal = await this.journalRepo.create({
      organizationId,
      code: input.code,
      label: input.label,
      kind: input.kind,
      defaultAccountId: input.defaultAccountId ?? null,
    });

    await this.audit
      .record({
        module: JournalsService.MODULE,
        action: 'journals.journal_created',
        entityType: 'journal',
        entityId: journal.id,
        metadata: { code: journal.code, kind: journal.kind, label: journal.label },
        ctx,
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));

    return journal;
  }
}
