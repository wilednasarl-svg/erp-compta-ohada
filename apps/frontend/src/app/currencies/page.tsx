'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Coins, Loader2, Plus, Repeat } from 'lucide-react';
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

/**
 * `/currencies` — Module 16 wave 1 : devises ISO 4217 + taux de change
 * pluridates + convertisseur pur.
 *
 * Surface :
 *   - section A : devises (CRUD léger create + désactivation).
 *   - section B : taux de change (saisie manuelle ou source bceao/ecb/imported)
 *     + tableau historique trié desc par date.
 *   - section C : convertisseur interactif (montant + paire + date) qui
 *     appelle GET /exchange-rates/convert et affiche le résultat live.
 */
export default function CurrenciesPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();

  const currenciesQuery = useQuery<ReadonlyArray<Currency>, ApiError>({
    queryKey: ['currencies', orgId],
    queryFn: async () => {
      const data = await api.get<CurrenciesResponse>(`/organizations/${orgId}/currencies`);
      return data.currencies;
    },
    enabled: orgId !== '',
  });

  const ratesQuery = useQuery<ReadonlyArray<ExchangeRate>, ApiError>({
    queryKey: ['exchange-rates', orgId],
    queryFn: async () => {
      const data = await api.get<RatesResponse>(`/organizations/${orgId}/exchange-rates`);
      return data.rates;
    },
    enabled: orgId !== '',
  });

  // ─── Create currency ─────────────────────────────────────────────
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

  // ─── Create rate ─────────────────────────────────────────────────
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

  // ─── Converter ───────────────────────────────────────────────────
  const [convAmount, setConvAmount] = useState('');
  const [convFrom, setConvFrom] = useState('');
  const [convTo, setConvTo] = useState('');
  const [convDate, setConvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [convResult, setConvResult] = useState<ConvertResponse | null>(null);

  const convert = useApiMutation(
    async () => {
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
    },
  );

  const sortedRates = [...(ratesQuery.data ?? [])].sort((a, b) =>
    b.rateDate.localeCompare(a.rateDate),
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-[1100px] animate-page-in space-y-12">
        <header className="border-b border-line pb-3">
          <p className="eyebrow mb-2">Référentiel</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Devises & Taux de change
          </h1>
          <p className="mt-2 text-sm text-ink-mute">
            Référentiel ISO 4217 et historique des taux multi-source (manuel, BCEAO, BCE,
            importé). Le convertisseur sélectionne automatiquement le taux le plus récent
            ≤ à la date demandée.
          </p>
        </header>

        {/* DEVISES */}
        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Devises</h2>
            <p className="mt-1 text-sm text-ink-mute">
              XOF (FCFA UEMOA) seedé par défaut à la création d&apos;org. Ajouter EUR, USD,
              KES etc. selon les flux multi-devises de l&apos;entreprise.
            </p>
          </div>
          <div className="space-y-4 rounded-sm border border-line bg-paper p-5">
            <form
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
                  className="rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
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

            {currenciesQuery.isLoading ? (
              <p className="text-sm text-ink-mute">Chargement…</p>
            ) : (currenciesQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-mute">Aucune devise.</p>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-sunk">
                    <tr>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Code</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Libellé</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Symbole</span></th>
                      <th className="px-3 py-2 text-right"><span className="eyebrow">Décimales</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Statut</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(currenciesQuery.data ?? []).map((c, i) => (
                      <tr
                        key={c.id}
                        className={i % 2 === 0 ? 'bg-paper' : 'bg-sunk/25'}
                      >
                        <td className="px-3 py-2 font-mono font-medium text-ink">{c.code}</td>
                        <td className="px-3 py-2 text-ink">{c.label}</td>
                        <td className="px-3 py-2 text-ink">{c.symbol ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-ink">{c.decimalPlaces}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded-xs px-2 py-0.5 font-mono text-[11px] ${
                              c.isActive
                                ? 'bg-accent-soft text-accent-ink'
                                : 'bg-sunk text-ink-mute'
                            }`}
                          >
                            {c.isActive ? 'Actif' : 'Inactif'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <FormError error={currenciesQuery.error} />
          </div>
        </section>

        {/* TAUX */}
        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Taux de change</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Historique pluridates. Le convertisseur prend toujours le taux le plus récent
              ≤ à la date demandée.
            </p>
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
                  className="rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
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

            {ratesQuery.isLoading ? (
              <p className="text-sm text-ink-mute">Chargement…</p>
            ) : sortedRates.length === 0 ? (
              <p className="text-sm text-ink-mute">Aucun taux enregistré.</p>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-sunk">
                    <tr>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Date</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Paire</span></th>
                      <th className="px-3 py-2 text-right"><span className="eyebrow">Taux</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Source</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Référence</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRates.slice(0, 100).map((r, i) => (
                      <tr
                        key={r.id}
                        className={i % 2 === 0 ? 'bg-paper' : 'bg-sunk/25'}
                      >
                        <td className="px-3 py-2 font-mono text-ink">{r.rateDate}</td>
                        <td className="px-3 py-2 text-ink">
                          <span className="font-mono">{r.fromCurrencyCode}</span>
                          <ArrowRight className="mx-1 inline h-3 w-3 text-ink-mute" />
                          <span className="font-mono">{r.toCurrencyCode}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink">{r.rate}</td>
                        <td className="px-3 py-2">
                          <span className="inline-block rounded-xs bg-sunk px-2 py-0.5 font-mono text-[11px] text-ink-mute">
                            {r.source}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-mute">
                          {r.sourceRef ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <FormError error={ratesQuery.error} />
          </div>
        </section>

        {/* CONVERTISSEUR */}
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
              <div className="mt-3 rounded-sm border border-accent/30 bg-accent-soft p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-accent-ink" />
                  <span className="font-medium text-ink">
                    {convAmount} {convResult.fromCurrencyCode}
                  </span>
                  <ArrowRight className="h-3 w-3 text-ink-mute" />
                  <span className="font-mono font-medium text-accent-ink">
                    {convResult.amount} {convResult.toCurrencyCode}
                  </span>
                </div>
                <div className="mt-1 text-xs text-ink-mute">
                  Taux appliqué : 1 {convResult.fromCurrencyCode} ={' '}
                  <span className="font-mono">{convResult.rate}</span>{' '}
                  {convResult.toCurrencyCode} (taux du {convResult.rateDate})
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
