'use client';

/**
 * `usePeriodValidity` — indice de validité de la période AVANT génération
 * (AC-V5). Interroge l'endpoint léger `GET /organizations/:org/reports/validity`
 * pour dire, dès le choix de la période, si l'état sera fiable : nombre
 * d'écritures committées, équilibre du journal, dernier mouvement.
 *
 * Remplace la dérivation post-génération comme source pré-génération : tant
 * qu'aucun rapport n'est produit, le `DataValidityStrip` reflète déjà la
 * matière première réelle de l'organisation sur la période sélectionnée.
 */

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';

import type { PeriodValidity, PeriodValue } from './types';

/** Convertit une période (range ou as-at) en fenêtre [fromDate, toDate]. */
const toWindow = (period: PeriodValue): { readonly fromDate: string; readonly toDate: string } =>
  period.kind === 'range'
    ? { fromDate: period.fromDate, toDate: period.toDate }
    : { fromDate: period.fiscalYearStartDate, toDate: period.asAtDate };

export function usePeriodValidity(
  orgId: string,
  period: PeriodValue,
): PeriodValidity | undefined {
  const { fromDate, toDate } = toWindow(period);
  const query = useQuery<PeriodValidity>({
    queryKey: ['reports-validity', orgId, fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate, toDate });
      const data = await api.get<{ validity: PeriodValidity }>(
        `/organizations/${orgId}/reports/validity?${params.toString()}`,
      );
      return data.validity;
    },
    enabled: orgId !== '',
    staleTime: 30_000,
  });
  return query.data;
}
