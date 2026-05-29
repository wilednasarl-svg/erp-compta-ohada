'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Banknote,
  Coins,
  LineChart,
  Loader2,
  Plus,
  Repeat,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

type RateSource = 'manual' | 'bceao' | 'ecb' | 'imported';

interface Currency {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly decimalPlaces: 0 | 2 | 3;
  readonly symbol: string | null;
  readonly isActive: boolean;
}

interface ExchangeRate {
  readonly id: string;
  readonly fromCurrencyCode: string;
  readonly toCurrencyCode: string;
  readonly rateDate: string;
  readonly rate: string;
  readonly source: RateSource;
  readonly sourceRef: string | null;
}

interface CurrenciesResponse {
  readonly currencies: ReadonlyArray<Currency>;
}
interface RatesResponse {
  readonly rates: ReadonlyArray<ExchangeRate>;
}
interface ConvertResponse {
  readonly amount: string;
  readonly rate: string;
  readonly fromCurrencyCode: string;
  readonly toCurrencyCode: string;
  readonly rateDate: string;
}

const SOURCE_TONE: Record<RateSource, string> = {
  manual: 'bg-sunk text-ink-mute',
  bceao: 'bg-info-soft text-info-ink',
  ecb: 'bg-accent-soft text-accent-ink',
  imported: 'bg-warn-soft text-warn-ink',
};

const SOURCE_LABEL: Record<RateSource, string> = {
  manual: 'Manuel',
  bceao: 'BCEAO',
  ecb: 'BCE',
  imported: 'Importé',
};

function formatRate(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="animate-pulse space-y-px">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-3 w-14 rounded-xs bg-sunk" />
          <div className="h-3 w-32 flex-1 rounded-xs bg-sunk" />
          <div className="h-5 w-14 rounded-full bg-sunk" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[40ch] text-xs text-ink-mute">{description}</p>
      </div>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

function StatusChip({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active ? 'bg-accent-soft text-accent-ink' : 'bg-sunk text-ink-mute'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {active ? 'Actif' : 'Inactif'}
    </span>
  );
}

function SourceChip({ source }: { source: RateSource }) {
  return (
    <span
      className={`inline-flex items-center rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${SOURCE_TONE[source]}`}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

export default function CurrenciesPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();

  const currenciesQuery = useQuery<ReadonlyArray<Currency>, ApiError>({
    queryKey: ['currencies', orgId],
    queryFn: async () => {
      const data = await api.get<CurrenciesResponse>(
        `/organizations/${orgId}/currencies`,
      );
      return data.currencies;
    },
    enabled: orgId !== '',
  });

  const ratesQuery = useQuery<ReadonlyArray<ExchangeRate>, ApiError>({
    queryKey: ['exchange-rates', orgId],
    queryFn: async () => {
      const data = await api.get<RatesResponse>(
        `/organizations/${orgId}/exchange-rates`,
      );
      return data.rates;
    },
    enabled: orgId !== '',
  });

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [decimals, setDecimals] = useState<0 | 2 | 3>(2);
  const [symbol, setSymbol] = useState('');

  const createCurrency = useApiMutation(
    async () =>
      api.post(`/organizations/${orgId}/currencies`, {
        code: code.trim().toUpperCase(),
        label: label.trim(),
        decimalPlaces: decimals,
        symbol: symbol.trim() === '' ? undefined : symbol.trim(),
        isActive: true,
      }),
    {
      onSuccess: () => {
        setCode('');
        setLabel('');
        setSymbol('');
        void qc.invalidateQueries({ queryKey: ['currencies', orgId] });
      },
    },
  );

  const [fromCode, setFromCode] = useState('');
  const [toCode, setToCode] = useState('');
  const [rateDate, setRateDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rateValue, setRateValue] = useState('');
  const [source, setSource] = useState<RateSource>('manual');
  const [sourceRef, setSourceRef] = useState('');

  const createRate = useApiMutation(
    async () => {
      const body: Record<string, unknown> = {
        fromCurrencyCode: fromCode.trim().toUpperCase(),
        toCurrencyCode: toCode.trim().toUpperCase(),
        rateDate,
        rate: rateValue.trim(),
        source,
      };
      if (sourceRef.trim() !== '') body.sourceRef = sourceRef.trim();
      return api.post(`/organizations/${orgId}/exchange-rates`, body);
    },
    {
      onSuccess: () => {
        setRateValue('');
        setSourceRef('');
        void qc.invalidateQueries({ queryKey: ['exchange-rates', orgId] });
      },
    },
  );

  const [convAmount, setConvAmount] = useState('');
  const [convFrom, setConvFrom] = useState('');
  const [convTo, setConvTo] = useState('');
  const [convDate, setConvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [convResult, setConvResult] = useState<ConvertResponse | null>(null);

  const convert = useApiMutation(async () => {
    const params = new URLSearchParams({
      amount: convAmount.trim(),
      from: convFrom.trim().toUpperCase(),
      to: convTo.trim().toUpperCase(),
      date: convDate,
    });
    const data = await api.get<ConvertResponse>(
      `/organizations/${orgId}/exchange-rates/convert?${params.toString()}`,
    );
    setConvResult(data);
    return data;
  });

  const sortedRates = [...(ratesQuery.data ?? [])].sort((a, b) =>
    b.rateDate.localeCompare(a.rateDate),
  );

  const activeCount = (currenciesQuery.data ?? []).filter((c) => c.isActive).length;
  const totalCount = (currenciesQuery.data ?? []).length;

  const scrollToAddCurrency = () => {
    document
      .getElementById('add-currency-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-12">
        <header className="flex items-start justify-between gap-6 border-b border-line pb-6">
          <div>
            <p className="eyebrow mb-2">Référentiel</p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Devises &amp; Taux de change
            </h1>
            <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
              Référentiel ISO 4217 et historique des taux multi-source (manuel, BCEAO,
              BCE, importé). Le convertisseur sélectionne automatiquement le taux le plus
              récent <span className="font-mono">≤</span> à la date demandée.
            </p>
          </div>
          <button
            type="button"
            onClick={scrollToAddCurrency}
            className="press hidden shrink-0 items-center gap-1.5 self-start rounded-sm bg-accent-soft px-3 py-2 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas sm:inline-flex"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Ajouter une devise
          </button>
        </header>

        <section className="space-y-4">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-xl font-medium text-ink">Devises</h2>
              {!currenciesQuery.isLoading && totalCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-sunk px-2 py-0.5 font-mono text-[11px] text-ink-mute">
                  {activeCount}/{totalCount} active{activeCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <span className="hidden text-xs text-ink-mute md:inline">
              XOF (FCFA UEMOA) seedé par défaut
            </span>
          </div>

          <div className="space-y-4 rounded-sm border border-line bg-paper p-5">
            <form
              id="add-currency-form"
              className="grid grid-cols-1 gap-3 md:grid-cols-[100px_2fr_120px_140px_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                createCurrency.mutate(undefined);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="c-code">Code ISO</Label>
                <Input
                  id="c-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="EUR"
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-label">Libellé</Label>
                <Input
                  id="c-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Euro"
                  maxLength={80}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-dec">Décimales</Label>
                <select
                  id="c-dec"
                  value={decimals}
                  onChange={(e) => setDecimals(Number(e.target.value) as 0 | 2 | 3)}
                  className="w-full rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none"
                >
                  <option value={0}>0 (XOF, JPY)</option>
                  <option value={2}>2 (EUR, USD)</option>
                  <option value={3}>3 (KWD, BHD)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-sym">Symbole</Label>
                <Input
                  id="c-sym"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="€"
                  maxLength={8}
                />
              </div>
              <Button type="submit" disabled={createCurrency.isPending} className="press">
                {createCurrency.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Créer
              </Button>
            </form>
            <FormError error={createCurrency.error} />

            <div className="overflow-hidden rounded-sm border border-line">
              {currenciesQuery.isLoading ? (
                <SkeletonRows n={4} />
              ) : (currenciesQuery.data ?? []).length === 0 ? (
                <EmptyState
                  icon={Banknote}
                  title="Aucune devise enregistrée"
                  description="Ajoutez EUR, USD ou toute devise utilisée par vos flux multi-devises."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-sunk">
                      <tr>
                        <th className="px-3 py-2 text-left">
                          <span className="eyebrow">Code</span>
                        </th>
                        <th className="px-3 py-2 text-left">
                          <span className="eyebrow">Libellé</span>
                        </th>
                        <th className="px-3 py-2 text-left">
                          <span className="eyebrow">Symbole</span>
                        </th>
                        <th className="px-3 py-2 text-right">
                          <span className="eyebrow">Décimales</span>
                        </th>
                        <th className="px-3 py-2 text-left">
                          <span className="eyebrow">Statut</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {(currenciesQuery.data ?? []).map((c) => (
                        <tr
                          key={c.id}
                          className="bg-paper transition-colors duration-fast hover:bg-sunk/40"
                        >
                          <td className="px-3 py-2.5 font-mono font-medium tabular-nums text-ink">
                            {c.code}
                          </td>
                          <td className="px-3 py-2.5 text-ink">{c.label}</td>
                          <td className="px-3 py-2.5 text-ink">
                            {c.symbol ?? <span className="text-ink-mute">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">
                            {c.decimalPlaces}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusChip active={c.isActive} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <FormError error={currenciesQuery.error} />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-xl font-medium text-ink">Taux de change</h2>
              {!ratesQuery.isLoading && sortedRates.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-sunk px-2 py-0.5 font-mono text-[11px] text-ink-mute">
                  {sortedRates.length} taux
                </span>
              )}
            </div>
            <span className="hidden text-xs text-ink-mute md:inline">
              Le convertisseur utilise toujours le taux le plus récent ≤ date
            </span>
          </div>
          <div className="space-y-4 rounded-sm border border-line bg-paper p-5">
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-[80px_80px_140px_180px_140px_1fr_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                createRate.mutate(undefined);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="r-from">De</Label>
                <Input
                  id="r-from"
                  value={fromCode}
                  onChange={(e) => setFromCode(e.target.value.toUpperCase())}
                  placeholder="EUR"
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-to">Vers</Label>
                <Input
                  id="r-to"
                  value={toCode}
                  onChange={(e) => setToCode(e.target.value.toUpperCase())}
                  placeholder="XOF"
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-date">Date</Label>
                <Input
                  id="r-date"
                  type="date"
                  value={rateDate}
                  onChange={(e) => setRateDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-rate">Taux (1 De = N Vers)</Label>
                <Input
                  id="r-rate"
                  value={rateValue}
                  onChange={(e) => setRateValue(e.target.value)}
                  placeholder="655.957"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-src">Source</Label>
                <select
                  id="r-src"
                  value={source}
                  onChange={(e) => setSource(e.target.value as RateSource)}
                  className="w-full rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none"
                >
                  <option value="manual">Manuel</option>
                  <option value="bceao">BCEAO</option>
                  <option value="ecb">BCE</option>
                  <option value="imported">Importé</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-ref">Référence (optionnel)</Label>
                <Input
                  id="r-ref"
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  placeholder="URL BCEAO, batch_id…"
                  maxLength={200}
                />
              </div>
              <Button type="submit" disabled={createRate.isPending} className="press">
                {createRate.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Ajouter
              </Button>
            </form>
            <FormError error={createRate.error} />

            <div className="overflow-hidden rounded-sm border border-line">
              {ratesQuery.isLoading ? (
                <SkeletonRows n={5} />
              ) : sortedRates.length === 0 ? (
                <EmptyState
                  icon={LineChart}
                  title="Aucun taux enregistré"
                  description="Saisissez un premier taux (manuel ou importé) pour activer le convertisseur."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-sunk">
                      <tr>
                        <th className="px-3 py-2 text-left">
                          <span className="eyebrow">Date</span>
                        </th>
                        <th className="px-3 py-2 text-left">
                          <span className="eyebrow">Paire</span>
                        </th>
                        <th className="px-3 py-2 text-right">
                          <span className="eyebrow">Taux</span>
                        </th>
                        <th className="px-3 py-2 text-left">
                          <span className="eyebrow">Source</span>
                        </th>
                        <th className="px-3 py-2 text-left">
                          <span className="eyebrow">Référence</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {sortedRates.slice(0, 100).map((r) => (
                        <tr
                          key={r.id}
                          className="bg-paper transition-colors duration-fast hover:bg-sunk/40"
                        >
                          <td className="px-3 py-2.5 font-mono tabular-nums text-ink">
                            {r.rateDate}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1 font-mono text-ink">
                              <span>{r.fromCurrencyCode}</span>
                              <ArrowRight className="h-3 w-3 text-ink-mute" />
                              <span>{r.toCurrencyCode}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-medium tabular-nums text-ink">
                            {formatRate(r.rate)}
                          </td>
                          <td className="px-3 py-2.5">
                            <SourceChip source={r.source} />
                          </td>
                          <td className="px-3 py-2.5 text-xs text-ink-mute">
                            {r.sourceRef ?? <span className="text-ink-mute/60">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <FormError error={ratesQuery.error} />
          </div>
        </section>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Convertisseur</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Conversion à la date passée. Si aucun taux n&apos;est trouvé à cette date,
              le backend remonte une erreur explicite.
            </p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-5">
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-[160px_80px_80px_140px_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                convert.mutate(undefined);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="conv-amt">Montant</Label>
                <Input
                  id="conv-amt"
                  value={convAmount}
                  onChange={(e) => setConvAmount(e.target.value)}
                  placeholder="1500.00"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="conv-from">De</Label>
                <Input
                  id="conv-from"
                  value={convFrom}
                  onChange={(e) => setConvFrom(e.target.value.toUpperCase())}
                  placeholder="EUR"
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="conv-to">Vers</Label>
                <Input
                  id="conv-to"
                  value={convTo}
                  onChange={(e) => setConvTo(e.target.value.toUpperCase())}
                  placeholder="XOF"
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="conv-date">Date</Label>
                <Input
                  id="conv-date"
                  type="date"
                  value={convDate}
                  onChange={(e) => setConvDate(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={convert.isPending} className="press">
                {convert.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Repeat className="mr-2 h-4 w-4" />
                )}
                Convertir
              </Button>
            </form>
            <FormError error={convert.error} className="mt-3" />
            {convResult && (
              <div className="mt-4 overflow-hidden rounded-sm border border-accent/30 bg-accent-soft/60">
                <div className="flex items-center justify-between gap-4 border-b border-accent/20 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Coins className="h-4 w-4 text-accent-ink" strokeWidth={1.75} />
                    <span className="font-mono tabular-nums text-ink">
                      {convAmount} {convResult.fromCurrencyCode}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-ink-mute" />
                    <span className="font-display text-lg font-medium tabular-nums text-accent-ink">
                      {convResult.amount}{' '}
                      <span className="text-base font-normal">
                        {convResult.toCurrencyCode}
                      </span>
                    </span>
                  </div>
                </div>
                <dl className="grid grid-cols-2 divide-x divide-accent/20 text-xs">
                  <div className="px-4 py-2.5">
                    <dt className="eyebrow mb-1">Taux appliqué</dt>
                    <dd className="font-mono tabular-nums text-ink">
                      1 {convResult.fromCurrencyCode} ={' '}
                      <span className="font-medium">{formatRate(convResult.rate)}</span>{' '}
                      {convResult.toCurrencyCode}
                    </dd>
                  </div>
                  <div className="px-4 py-2.5">
                    <dt className="eyebrow mb-1">Date du taux</dt>
                    <dd className="font-mono tabular-nums text-ink">{convResult.rateDate}</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
