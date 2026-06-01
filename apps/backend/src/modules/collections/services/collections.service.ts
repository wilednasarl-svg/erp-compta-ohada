import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import {
  OpenReceivablesRepository,
  type OpenReceivableLine,
} from '../repositories/open-receivables.repository';
import {
  agingBucket,
  daysOverdue,
  dunningLevel,
  dunningLevelLabel,
  type AgingBucket,
  type DunningLevel,
} from '../lib/dunning-rules';
import { buildDunningLetter, type DunningLetter } from '../lib/dunning-letter';
import { buildReceivablesCsv, type ReceivableCsvRow } from '../lib/receivables-csv';

export interface ReceivableDetailRow {
  readonly partnerAccountId: string;
  readonly partnerCode: string;
  readonly partnerLabel: string;
  readonly invoiceNumber: string | null;
  readonly dueDate: string | null;
  readonly amount: string;
  readonly overdueDays: number | null;
  readonly bucket: AgingBucket;
}

export interface DunningCandidate {
  readonly partnerAccountId: string;
  readonly partnerCode: string;
  readonly partnerLabel: string;
  readonly totalOpen: string;
  readonly totalOverdue: string;
  readonly maxOverdueDays: number;
  readonly level: DunningLevel;
  readonly levelLabel: string;
  readonly invoiceCount: number;
  readonly overdueInvoiceCount: number;
}

export interface CollectionsQuery {
  readonly referenceDate: string;
  readonly partnerAccountId?: string;
  readonly overdueOnly?: boolean;
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Recouvrement client : détail des créances ouvertes, identification des
 * clients à relancer (avec palier), génération de lettres de relance, et
 * export CSV. Lecture seule sur la comptabilité (aucune écriture, aucune
 * migration) — le suivi persistant des relances est une itération ultérieure.
 */
@Injectable()
export class CollectionsService {
  constructor(private readonly receivables: OpenReceivablesRepository) {}

  /** Détail ligne à ligne des créances clients ouvertes (avec retard/tranche). */
  async getReceivablesDetail(
    organizationId: TenantId,
    query: CollectionsQuery,
  ): Promise<ReceivableDetailRow[]> {
    assertTenantId(organizationId);
    const lines = await this.receivables.listOpenClientLines(organizationId, {
      partnerAccountId: query.partnerAccountId,
    });

    const rows = lines.map((line) => this.toDetailRow(line, query.referenceDate));
    return query.overdueOnly ? rows.filter((r) => (r.overdueDays ?? 0) > 0) : rows;
  }

  /** Clients présentant au moins une créance échue, regroupés par palier. */
  async getDunningCandidates(
    organizationId: TenantId,
    referenceDate: string,
  ): Promise<DunningCandidate[]> {
    assertTenantId(organizationId);
    const lines = await this.receivables.listOpenClientLines(organizationId);

    const byPartner = new Map<string, MutableCandidate>();
    for (const line of lines) {
      const overdue = daysOverdue(line.dueDate, referenceDate);
      const net = Number(line.amount);
      let agg = byPartner.get(line.partnerAccountId);
      if (agg === undefined) {
        agg = {
          partnerAccountId: line.partnerAccountId,
          partnerCode: line.partnerCode,
          partnerLabel: line.partnerLabel,
          totalOpen: 0,
          totalOverdue: 0,
          maxOverdueDays: 0,
          invoiceCount: 0,
          overdueInvoiceCount: 0,
        };
        byPartner.set(line.partnerAccountId, agg);
      }
      agg.totalOpen += net;
      agg.invoiceCount += 1;
      if (overdue !== null && overdue > 0) {
        agg.totalOverdue += net;
        agg.overdueInvoiceCount += 1;
        if (overdue > agg.maxOverdueDays) agg.maxOverdueDays = overdue;
      }
    }

    return [...byPartner.values()]
      .filter((c) => c.overdueInvoiceCount > 0)
      .map((c) => {
        const level = dunningLevel(c.maxOverdueDays);
        return {
          partnerAccountId: c.partnerAccountId,
          partnerCode: c.partnerCode,
          partnerLabel: c.partnerLabel,
          totalOpen: round2(c.totalOpen),
          totalOverdue: round2(c.totalOverdue),
          maxOverdueDays: c.maxOverdueDays,
          level,
          levelLabel: dunningLevelLabel(level),
          invoiceCount: c.invoiceCount,
          overdueInvoiceCount: c.overdueInvoiceCount,
        };
      })
      .sort((a, b) => b.maxOverdueDays - a.maxOverdueDays);
  }

  /** Lettre de relance d'un client, à partir de ses factures échues. */
  async buildLetter(
    organizationId: TenantId,
    partnerAccountId: string,
    options: { referenceDate: string; creditorName: string; currency?: string },
  ): Promise<DunningLetter> {
    assertTenantId(organizationId);
    const lines = await this.receivables.listOpenClientLines(organizationId, { partnerAccountId });

    const overdue = lines
      .map((line) => ({ line, days: daysOverdue(line.dueDate, options.referenceDate) }))
      .filter((x) => x.days !== null && x.days > 0);

    if (overdue.length === 0) {
      throw new AppException(ERROR_CODES.COLLECTIONS_NO_OVERDUE, {
        message: 'Aucune créance échue à relancer pour ce client.',
      });
    }

    const partnerLabel = lines[0]?.partnerLabel ?? partnerAccountId;
    const maxDays = overdue.reduce((m, x) => Math.max(m, x.days ?? 0), 0);
    const total = overdue.reduce((sum, x) => sum + Number(x.line.amount), 0);

    return buildDunningLetter({
      creditorName: options.creditorName,
      partnerLabel,
      referenceDate: options.referenceDate,
      level: dunningLevel(maxDays),
      currency: options.currency,
      totalOverdue: round2(total),
      invoices: overdue.map((x) => ({
        invoiceNumber: x.line.invoiceNumber ?? '—',
        dueDate: x.line.dueDate ?? '',
        amount: x.line.amount,
        overdueDays: x.days ?? 0,
      })),
    });
  }

  /** Export CSV du détail des créances (toutes ou échues uniquement). */
  async exportReceivablesCsv(
    organizationId: TenantId,
    query: CollectionsQuery,
  ): Promise<string> {
    const rows = await this.getReceivablesDetail(organizationId, query);
    const csvRows: ReceivableCsvRow[] = rows.map((r) => ({
      partnerCode: r.partnerCode,
      partnerLabel: r.partnerLabel,
      invoiceNumber: r.invoiceNumber ?? '',
      dueDate: r.dueDate ?? '',
      amount: r.amount,
      overdueDays: r.overdueDays === null ? '' : String(r.overdueDays),
      bucket: r.bucket,
    }));
    return buildReceivablesCsv(csvRows, { withBom: true });
  }

  private toDetailRow(line: OpenReceivableLine, referenceDate: string): ReceivableDetailRow {
    const overdue = daysOverdue(line.dueDate, referenceDate);
    return {
      partnerAccountId: line.partnerAccountId,
      partnerCode: line.partnerCode,
      partnerLabel: line.partnerLabel,
      invoiceNumber: line.invoiceNumber,
      dueDate: line.dueDate,
      amount: line.amount,
      overdueDays: overdue,
      bucket: agingBucket(overdue),
    };
  }
}

interface MutableCandidate {
  partnerAccountId: string;
  partnerCode: string;
  partnerLabel: string;
  totalOpen: number;
  totalOverdue: number;
  maxOverdueDays: number;
  invoiceCount: number;
  overdueInvoiceCount: number;
}
