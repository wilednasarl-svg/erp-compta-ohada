import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationAccountEntity } from '../../accounting-plan/entities/organization-account.entity';
import { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../entities/journal-entry.entity';

export interface CreateLineInput {
  readonly organizationId: TenantId | string;
  readonly journalEntryId: string;
  readonly accountId: string;
  readonly position: number;
  readonly description?: string | null;
  readonly debit: string;
  readonly credit: string;
  readonly analyticAxisType?: string | null;
  readonly analyticAxisCode?: string | null;
  /** Métadonnées de pièce (Migration 0110). */
  readonly invoiceNumber?: string | null;
  readonly dueDate?: string | null;
  readonly taxCode?: string | null;
  readonly reference?: string | null;
}

@Injectable()
export class JournalEntryLineRepository {
  constructor(
    @InjectRepository(JournalEntryLineEntity)
    private readonly repo: Repository<JournalEntryLineEntity>,
  ) {}

  async createMany(
    lines: CreateLineInput[],
    manager?: EntityManager,
  ): Promise<JournalEntryLineEntity[]> {
    if (lines.length === 0) return [];
    const repo = manager ? manager.getRepository(JournalEntryLineEntity) : this.repo;
    const entities = repo.create(
      lines.map((l) => ({
        organizationId: l.organizationId,
        journalEntryId: l.journalEntryId,
        accountId: l.accountId,
        position: l.position,
        description: l.description ?? null,
        debit: l.debit,
        credit: l.credit,
        lineLetter: null,
        analyticAxisType: l.analyticAxisType ?? null,
        analyticAxisCode: l.analyticAxisCode ?? null,
        invoiceNumber: l.invoiceNumber ?? null,
        dueDate: l.dueDate ?? null,
        taxCode: l.taxCode ?? null,
        reference: l.reference ?? null,
      })),
    );
    return repo.save(entities);
  }

  async listByEntry(entryId: string): Promise<JournalEntryLineEntity[]> {
    return this.repo.find({
      where: { journalEntryId: entryId },
      order: { position: 'ASC' },
    });
  }

  async listByAccountAndOrg(
    organizationId: TenantId | string,
    accountId: string,
  ): Promise<JournalEntryLineEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, accountId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Lettering helper: load all `journal_entry_lines` matching the given
   * IDs IN this tenant, joining the parent entry so the caller can
   * filter on `journal_entries.status` (a draft line must never be
   * lettered — only validated ones). Returns lines in the same order
   * the IDs were requested where possible.
   */
  async listForLetteringCheck(
    organizationId: TenantId | string,
    ids: readonly string[],
  ): Promise<
    Array<{
      line: JournalEntryLineEntity;
      entryStatus: string;
    }>
  > {
    assertTenantId(organizationId);
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.repo
      .createQueryBuilder('l')
      .innerJoinAndMapOne('l.journalEntry', JournalEntryEntity, 'e', 'e.id = l.journal_entry_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere('l.id IN (:...ids)', { ids: [...ids] })
      .getMany();
    return rows.map((line) => ({
      line,
      entryStatus: line.journalEntry?.status ?? 'unknown',
    }));
  }

  /**
   * Lettrage auto par facture : retourne les lignes encore NON lettrées,
   * portant un `invoice_number`, rattachées à une écriture `validated` et
   * à un compte tiers (classe 4, sous-classe 40/41/43/44). Chaque ligne
   * porte sa relation `account` mappée pour que le service puisse
   * regrouper par (compte, facture) et vérifier la classe.
   *
   * Tri stable par (compte, facture) pour un regroupement déterministe.
   */
  async listUnletteredPartnerLinesWithInvoice(
    organizationId: TenantId | string,
    options: { partnerAccountId?: string } = {},
  ): Promise<JournalEntryLineEntity[]> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('l')
      .innerJoinAndMapOne('l.account', OrganizationAccountEntity, 'a', 'a.id = l.account_id')
      .innerJoin(JournalEntryEntity, 'e', 'e.id = l.journal_entry_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere('l.lettering_id IS NULL')
      .andWhere('l.invoice_number IS NOT NULL')
      .andWhere("e.status = 'validated'")
      .andWhere('a.class = 4')
      .andWhere("substring(a.code from 1 for 2) IN ('40', '41', '43', '44')");
    if (options.partnerAccountId !== undefined) {
      qb.andWhere('l.account_id = :partnerAccountId', {
        partnerAccountId: options.partnerAccountId,
      });
    }
    return qb.orderBy('l.account_id', 'ASC').addOrderBy('l.invoice_number', 'ASC').getMany();
  }

  /**
   * Échéancier (balance âgée) : retourne les lignes encore OUVERTES
   * (non lettrées) des comptes tiers, rattachées à une écriture
   * `validated`. Une ligne ouverte = créance/dette non soldée. Chaque
   * ligne porte sa relation `account` mappée (code, libellé, classe) pour
   * que le service détermine le sens (client 41 / fournisseur 40) et le
   * libellé tiers.
   *
   * `subClasses` filtre les sous-classes tiers (défaut 40 + 41). Tri par
   * compte puis date d'échéance (NULLS LAST) pour un découpage stable.
   */
  async listOpenPartnerLines(
    organizationId: TenantId | string,
    options: { subClasses?: readonly string[]; partnerAccountId?: string } = {},
  ): Promise<JournalEntryLineEntity[]> {
    assertTenantId(organizationId);
    const subClasses = options.subClasses ?? ['40', '41'];
    const qb = this.repo
      .createQueryBuilder('l')
      .innerJoinAndMapOne('l.account', OrganizationAccountEntity, 'a', 'a.id = l.account_id')
      .innerJoin(JournalEntryEntity, 'e', 'e.id = l.journal_entry_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere('l.lettering_id IS NULL')
      .andWhere("e.status = 'validated'")
      .andWhere('a.class = 4')
      .andWhere('substring(a.code from 1 for 2) IN (:...subClasses)', {
        subClasses: [...subClasses],
      });
    if (options.partnerAccountId !== undefined) {
      qb.andWhere('l.account_id = :partnerAccountId', {
        partnerAccountId: options.partnerAccountId,
      });
    }
    return qb
      .orderBy('l.account_id', 'ASC')
      .addOrderBy('l.due_date', 'ASC', 'NULLS LAST')
      .getMany();
  }

  async attachLettering(
    lineIds: readonly string[],
    letteringId: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    if (lineIds.length === 0) return;
    const repo = manager ? manager.getRepository(JournalEntryLineEntity) : this.repo;
    await repo.update(
      { id: In([...lineIds]), organizationId, letteringId: IsNull() },
      { letteringId },
    );
  }

  async detachLettering(
    letteringId: string,
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<number> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(JournalEntryLineEntity) : this.repo;
    const result = await repo.update({ letteringId, organizationId }, { letteringId: null });
    return result.affected ?? 0;
  }
}
