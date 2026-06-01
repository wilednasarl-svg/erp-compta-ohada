'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';

interface ListResponse {
  readonly rows: ReadonlyArray<unknown>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

interface DocumentStatsProps {
  readonly orgId: string;
}

function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

interface StatCellProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly isLoading: boolean;
  readonly secondary?: string;
}

function StatCell({ label, value, isLoading, secondary }: StatCellProps) {
  return (
    <div className="flex flex-col gap-1 px-3 py-3 sm:px-4">
      <span className="eyebrow text-[10px] uppercase tracking-wider text-ink-mute">
        {label}
      </span>
      {isLoading ? (
        <span className="animate-pulse h-7 w-12 rounded-xs bg-sunk" aria-hidden="true" />
      ) : (
        <span className="font-mono tabular-nums text-2xl text-ink">{value ?? 0}</span>
      )}
      {secondary !== undefined && !isLoading ? (
        <span className="text-[10px] text-ink-mute">{secondary}</span>
      ) : null}
    </div>
  );
}

export function DocumentStats({ orgId }: DocumentStatsProps) {
  const enabled = orgId !== '';

  const totalAll = useQuery<ListResponse>({
    queryKey: ['documents', 'stats', orgId, 'all'],
    queryFn: () => api.get<ListResponse>('/documents?pageSize=1'),
    enabled,
  });

  const thisMonth = useQuery<ListResponse>({
    queryKey: ['documents', 'stats', orgId, 'month'],
    queryFn: () =>
      api.get<ListResponse>(
        `/documents?pageSize=1&uploadedFrom=${encodeURIComponent(firstOfMonthIso())}`,
      ),
    enabled,
  });

  const pendingOcr = useQuery<ListResponse>({
    queryKey: ['documents', 'stats', orgId, 'pending'],
    queryFn: () => api.get<ListResponse>('/documents?pageSize=1&ocrStatus=pending'),
    enabled,
  });

  const processedOcr = useQuery<ListResponse>({
    queryKey: ['documents', 'stats', orgId, 'processed'],
    queryFn: () => api.get<ListResponse>('/documents?pageSize=1&ocrStatus=processed'),
    enabled,
  });

  const total = totalAll.data?.total;
  const processed = processedOcr.data?.total;
  const processedPct =
    total !== undefined && total > 0 && processed !== undefined
      ? `${Math.round((processed / total) * 100)}% du total`
      : undefined;

  return (
    <div className="grid grid-cols-2 divide-x divide-line rounded-sm border border-line bg-paper sm:grid-cols-4">
      <StatCell label="Total" value={total} isLoading={totalAll.isLoading} />
      <StatCell label="Ce mois" value={thisMonth.data?.total} isLoading={thisMonth.isLoading} />
      <StatCell
        label="OCR en attente"
        value={pendingOcr.data?.total}
        isLoading={pendingOcr.isLoading}
      />
      <StatCell
        label="OCR traités"
        value={processed}
        isLoading={processedOcr.isLoading}
        secondary={processedPct}
      />
    </div>
  );
}
