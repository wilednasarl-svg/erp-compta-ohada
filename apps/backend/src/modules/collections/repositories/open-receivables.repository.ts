import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';
import { OrganizationAccountEntity } from '../../accounting-plan/entities/organization-account.entity';

/** Ligne de créance client ouverte, hydratée pour le recouvrement. */
export interface OpenReceivableLine {
  readonly partnerAccountId: string;
  readonly partnerCode: string;
  readonly partnerLabel: string;
  readonly invoiceNumber: string | null;
  readonly dueDate: string | null;
  /** Montant net signé (débit − crédit) en string DECIMAL 2 décimales. */
  readonly amount: string;
}

/**
 * Accès en lecture aux créances clients OUVERTES (sous-classe 41, non
 * lettrées, sur écritures validées), destiné au recouvrement / relances.
 *
 * Net-new et isolé : possède sa propre requête plutôt que de dépendre du
 * module Journals (évite tout couplage de wiring avec un fichier à fort
 * trafic). Les totaux par tiers réconcilient avec le grand livre auxiliaire
 * (mêmes filtres que l'échéancier : ligne ouverte = créance non soldée).
 */
@Injectable()
export class OpenReceivablesRepository {
  constructor(
    @InjectRepository(JournalEntryLineEntity)
    private readonly lines: Repository<JournalEntryLineEntity>,
  ) {}

  async listOpenClientLines(
    organizationId: TenantId,
    options: { partnerAccountId?: string } = {},
  ): Promise<OpenReceivableLine[]> {
    assertTenantId(organizationId);

    const qb = this.lines
      .createQueryBuilder('l')
      .innerJoin(OrganizationAccountEntity, 'a', 'a.id = l.account_id')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .select('l.account_id', 'partnerAccountId')
      .addSelect('a.code', 'partnerCode')
      .addSelect('a.label', 'partnerLabel')
      .addSelect('l.invoice_number', 'invoiceNumber')
      .addSelect('l.due_date', 'dueDate')
      .addSelect('l.debit', 'debit')
      .addSelect('l.credit', 'credit')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere('l.lettering_id IS NULL')
      .andWhere("e.status = 'validated'")
      .andWhere('a.class = 4')
      .andWhere("substring(a.code from 1 for 2) = '41'");

    if (options.partnerAccountId !== undefined) {
      qb.andWhere('l.account_id = :partnerAccountId', {
        partnerAccountId: options.partnerAccountId,
      });
    }

    const rows = await qb
      .orderBy('a.code', 'ASC')
      .addOrderBy('l.due_date', 'ASC', 'NULLS LAST')
      .getRawMany<{
        partnerAccountId: string;
        partnerCode: string;
        partnerLabel: string;
        invoiceNumber: string | null;
        dueDate: string | null;
        debit: string;
        credit: string;
      }>();

    return rows.map((r) => {
      const net = Number(r.debit) - Number(r.credit);
      return {
        partnerAccountId: r.partnerAccountId,
        partnerCode: r.partnerCode,
        partnerLabel: `${r.partnerCode} ${r.partnerLabel ?? ''}`.trim(),
        invoiceNumber: r.invoiceNumber,
        dueDate: r.dueDate,
        amount: (Math.round(net * 100) / 100).toFixed(2),
      };
    });
  }
}
