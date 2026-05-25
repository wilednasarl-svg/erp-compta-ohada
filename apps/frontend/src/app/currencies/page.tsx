'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Coins, Loader2, Plus, Repeat } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Devises & Taux de change</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Référentiel ISO 4217 et historique des taux multi-source (manuel, BCEAO, BCE,
            importé). Le convertisseur sélectionne automatiquement le taux le plus récent
            ≤ à la date demandée.
          </p>
        </header>

        {/* DEVISES */}
        <Card>
          <CardHeader>
            <CardTitle>Devises</CardTitle>
            <CardDescription>
              XOF (FCFA UEMOA) seedé par défaut à la création d&apos;org. Ajouter EUR, USD,
              KES etc. selon les flux multi-devises de l&apos;entreprise.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
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
              <Button type="submit" disabled={createCurrency.isPending}>
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
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (currenciesQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune devise.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Code</th>
                      <th className="px-3 py-2 text-left">Libellé</th>
                      <th className="px-3 py-2 text-left">Symbole</th>
                      <th className="px-3 py-2 text-right">Décimales</th>
                      <th className="px-3 py-2 text-left">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(currenciesQuery.data ?? []).map((c) => (
                      <tr key={c.id} className="border-t">
                        <td className="px-3 py-2 font-mono font-medium">{c.code}</td>
                        <td className="px-3 py-2">{c.label}</td>
                        <td className="px-3 py-2">{c.symbol ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{c.decimalPlaces}</td>
                        <td className="px-3 py-2">
                          <Badge variant={c.isActive ? 'default' : 'muted'}>
                            {c.isActive ? 'Actif' : 'Inactif'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <FormError error={currenciesQuery.error} />
          </CardContent>
        </Card>

        {/* TAUX */}
        <Card>
          <CardHeader>
            <CardTitle>Taux de change</CardTitle>
            <CardDescription>
              Historique pluridates. Le convertisseur prend toujours le taux le plus récent
              ≤ à la date demandée.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
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
              <Button type="submit" disabled={createRate.isPending}>
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
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : sortedRates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun taux enregistré.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Paire</th>
                      <th className="px-3 py-2 text-right">Taux</th>
                      <th className="px-3 py-2 text-left">Source</th>
                      <th className="px-3 py-2 text-left">Référence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRates.slice(0, 100).map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2 font-mono">{r.rateDate}</td>
                        <td className="px-3 py-2">
                          <span className="font-mono">{r.fromCurrencyCode}</span>
                          <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                          <span className="font-mono">{r.toCurrencyCode}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{r.rate}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline">{r.source}</Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {r.sourceRef ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <FormError error={ratesQuery.error} />
          </CardContent>
        </Card>

        {/* CONVERTISSEUR */}
        <Card>
          <CardHeader>
            <CardTitle>Convertisseur</CardTitle>
            <CardDescription>
              Conversion à la date passée. Si aucun taux n&apos;est trouvé à cette date,
              le backend remonte une erreur explicite.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
              <Button type="submit" disabled={convert.isPending}>
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
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-emerald-600" />
                  <span className="font-medium">
                    {convAmount} {convResult.fromCurrencyCode}
                  </span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-mono font-medium text-emerald-700">
                    {convResult.amount} {convResult.toCurrencyCode}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Taux appliqué : 1 {convResult.fromCurrencyCode} ={' '}
                  <span className="font-mono">{convResult.rate}</span>{' '}
                  {convResult.toCurrencyCode} (taux du {convResult.rateDate})
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
