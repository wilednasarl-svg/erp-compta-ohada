import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { DashboardsRepository, type AgingLineRow } from '../repositories/dashboards.repository';
import {
  AGING_BUCKETS,
  type AgingBucket,
  type AgingBucketSummary,
  type AgingType,
  type DashboardAging,
  type PartnerAgingRow,
} from '../types/dashboard-types';

/**
 * `DashboardAgingService` — balance âgée des comptes tiers (clients
 * et fournisseurs).
 *
 * Mécanique :
 *   1. Récupère toutes les lignes NON-LETTRÉES des comptes 41x (ou
 *      40x) sur l'exercice. Une ligne lettrée a déjà été compensée,
 *      elle ne porte plus de solde dû.
 *   2. Calcule pour chaque ligne `days_old = asOfDate - entry_date`
 *      (côté SQL pour la perf).
 *   3. Bucketise dans {0-30, 31-60, 61-90, >90} et agrège par compte
 *      (≈ partenaire dans la convention SYSCOHADA `4111-CLIENT-X`).
 *
 * Convention de signe :
 *   - clients (41x) : solde = débit - crédit. Une créance positive
 *     est due à l'org. On ignore les soldes négatifs (= avance
 *     reçue / acompte client, pas de l'aging).
 *   - fournisseurs (40x) : solde = crédit - débit. Une dette positive
 *     est due par l'org. Idem, on ignore les soldes négatifs.
 *
 * Par compte (= par tiers) on agrège D'ABORD le net signé, PUIS on
 * bucketise. Un compte avec 3 factures (-500, +1500, +800) à
 * différentes anciennetés finit avec un solde net positif distribué
 * proportionnellement sur l'âge moyen pondéré ? Non : convention
 * comptable plus simple → on prend la somme par bucket en gardant
 * chaque ligne dans son bucket, puis on n'expose que les buckets
 * dont le total reste positif après agrégation par compte. Une
 * créance partiellement réglée doit être lettrée pour disparaître
 * proprement — c'est le pattern OHADA.
 *
 * Implémentation simple : on additionne les nets par (compte, bucket).
 * Si un compte se retrouve total négatif à la fin, on l'exclut
 * (c'est un avantage net pour ce tiers, pas un aging).
 */
@Injectable()
export class DashboardAgingService {
  constructor(
    private readonly dashRepo: DashboardsRepository,
    private readonly periodsRepo: AccountingPeriodRepository,
  ) {}

  async getAging(
    organizationId: TenantId,
    input: {
      exerciseId: string;
      type: AgingType;
      asOfDate?: string;
    },
  ): Promise<DashboardAging> {
    const period = await this.periodsRepo.findById(input.exerciseId, organizationId);
    if (period === null || period.parentId !== null) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND, {
        message: `Exercise ${input.exerciseId} not found or is not a root annual period`,
      });
    }

    const asOfDate = input.asOfDate ?? period.endDate;
    const codePrefix = input.type === 'clients' ? '41' : '40';

    const lines = await this.dashRepo.unletteredLinesByCodePrefix(
      organizationId,
      period.startDate,
      period.endDate,
      asOfDate,
      codePrefix,
    );

    // Pour fournisseurs, on inverse le signe : crédit (= dette) devient
    // positif. Pour clients on garde le signe : débit (= créance) est
    // déjà positif.
    const signedLines: AgingLineRow[] =
      input.type === 'clients'
        ? lines
        : lines.map((l) => ({ ...l, netSigned: (-Number(l.netSigned)).toFixed(2) }));

    // Agrégation : Map<accountId, { code, label, byBucket }>.
    const byPartner = new Map<
      string,
      {
        accountId: string;
        accountCode: string;
        accountLabel: string;
        byBucket: Record<AgingBucket, number>;
      }
    >();

    for (const line of signedLines) {
      const bucket = pickBucket(line.daysOld);
      const partner = byPartner.get(line.accountId) ?? {
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountLabel: line.accountLabel,
        byBucket: { '0-30': 0, '31-60': 0, '61-90': 0, 'over-90': 0 },
      };
      partner.byBucket[bucket] += Number(line.netSigned);
      byPartner.set(line.accountId, partner);
    }

    // Filtre : un partenaire dont le total net est ≤ 0 n'a pas de
    // dette/créance à proprement parler (= avance reçue ou trop-versé)
    // — exclu de l'aging.
    const partnerBreakdown: PartnerAgingRow[] = [];
    for (const partner of byPartner.values()) {
      const total =
        partner.byBucket['0-30'] +
        partner.byBucket['31-60'] +
        partner.byBucket['61-90'] +
        partner.byBucket['over-90'];
      if (total <= 0) continue;

      partnerBreakdown.push({
        accountId: partner.accountId,
        accountCode: partner.accountCode,
        accountLabel: partner.accountLabel,
        totalOutstanding: total.toFixed(2),
        amountsByBucket: {
          '0-30': partner.byBucket['0-30'].toFixed(2),
          '31-60': partner.byBucket['31-60'].toFixed(2),
          '61-90': partner.byBucket['61-90'].toFixed(2),
          'over-90': partner.byBucket['over-90'].toFixed(2),
        },
      });
    }

    // Tri partenaire par totalOutstanding desc (les plus gros dus en
    // tête — c'est ce qu'un comptable veut voir en premier sur un
    // dashboard).
    partnerBreakdown.sort(
      (a, b) => Number(b.totalOutstanding) - Number(a.totalOutstanding),
    );

    // Totaux globaux par bucket. On somme à partir des partenaires
    // FILTRÉS (post-exclusion des avances), pour rester cohérent avec
    // le `totalOutstanding` global.
    const bucketTotals: Record<AgingBucket, { amount: number; lineCount: number }> = {
      '0-30': { amount: 0, lineCount: 0 },
      '31-60': { amount: 0, lineCount: 0 },
      '61-90': { amount: 0, lineCount: 0 },
      'over-90': { amount: 0, lineCount: 0 },
    };
    for (const partner of partnerBreakdown) {
      for (const b of AGING_BUCKETS) {
        const v = Number(partner.amountsByBucket[b]);
        if (v > 0) {
          bucketTotals[b].amount += v;
        }
      }
    }
    // Le lineCount global = comptage des lignes brutes (avant agrégation
    // par partenaire) qui ont contribué positivement.
    for (const line of signedLines) {
      if (Number(line.netSigned) <= 0) continue;
      const bucket = pickBucket(line.daysOld);
      bucketTotals[bucket].lineCount += 1;
    }

    const buckets: AgingBucketSummary[] = AGING_BUCKETS.map((b) => ({
      bucket: b,
      minDays: BUCKET_BOUNDS[b].min,
      maxDays: BUCKET_BOUNDS[b].max,
      amount: bucketTotals[b].amount.toFixed(2),
      lineCount: bucketTotals[b].lineCount,
    }));

    const totalOutstanding = partnerBreakdown
      .reduce((s, p) => s + Number(p.totalOutstanding), 0)
      .toFixed(2);

    return {
      organizationId,
      type: input.type,
      asOfDate,
      currency: 'XOF',
      buckets,
      totalOutstanding,
      partnerBreakdown,
    };
  }
}

const BUCKET_BOUNDS: Record<AgingBucket, { min: number; max: number | null }> = {
  '0-30': { min: 0, max: 30 },
  '31-60': { min: 31, max: 60 },
  '61-90': { min: 61, max: 90 },
  'over-90': { min: 91, max: null },
};

/**
 * Sélectionne le bucket pour une ancienneté donnée (jours). Une ligne
 * datée du futur (negative days) tombe dans '0-30' — éventualité due
 * à un asOfDate antérieur à l'écriture, considérée comme du préventif.
 */
export function pickBucket(daysOld: number): AgingBucket {
  if (daysOld <= 30) return '0-30';
  if (daysOld <= 60) return '31-60';
  if (daysOld <= 90) return '61-90';
  return 'over-90';
}
