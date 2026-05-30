'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Send,
  Wallet,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

// ─────────────────────────────────────────────────────────────────────────────
// Types (alignés sur le backend module fiscal — types/fiscal.types.ts)
// ─────────────────────────────────────────────────────────────────────────────

type FiscalDeclarationStatus = 'a_deposer' | 'depose' | 'paye' | 'annule';

const STATUS_LABELS: Record<FiscalDeclarationStatus, string> = {
  a_deposer: 'À déposer',
  depose: 'Déposé',
  paye: 'Payé',
  annule: 'Annulé',
};

// Transitions autorisées (miroir de FISCAL_STATUS_TRANSITIONS côté backend).
const STATUS_TRANSITIONS: Record<FiscalDeclarationStatus, FiscalDeclarationStatus[]> = {
  a_deposer: ['depose', 'annule'],
  depose: ['paye', 'a_deposer', 'annule'],
  paye: ['annule'],
  annule: [],
};

const TRANSITION_LABELS: Record<FiscalDeclarationStatus, string> = {
  a_deposer: 'Marquer à déposer',
  depose: 'Marquer déposé',
  paye: 'Marquer payé',
  annule: 'Annuler',
};

type FiscalDeclarationKind = 'fiscal' | 'social';

interface FiscalDeclaration {
  id: string;
  organizationId: string;
  taxCode: string;
  label: string | null;
  periodYear: number;
  periodMonth: number | null;
  baseAmount: string;
  rate: string;
  amountDue: string;
  currency: string;
  dueDate: string;
  status: FiscalDeclarationStatus;
  reference: string | null;
  justificatifUrl: string | null;
  chargeAccount: string | null;
  liabilityAccount: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListFiscalDeclarationsResponse {
  declarations: FiscalDeclaration[];
  total: number;
}

interface FiscalParameter {
  id: string;
  taxCode: string;
  label: string;
  declarationKind: FiscalDeclarationKind;
  rate: string;
  periodicity: 'monthly' | 'quarterly' | 'annual';
  dueDay: number;
  isActive: boolean;
}

interface ListFiscalParametersResponse {
  parameters: FiscalParameter[];
}

interface DeclarationEnvelope {
  declaration: FiscalDeclaration;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];
const MONTH_LABELS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

export default function FiscalPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const queryClient = useQueryClient();

  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [month, setMonth] = useState<string>('');
  const [taxCode, setTaxCode] = useState<string>('');
  const [status, setStatus] = useState<FiscalDeclarationStatus | ''>('');

  const declarationsQuery = useQuery<ListFiscalDeclarationsResponse, ApiError>({
    queryKey: ['fiscal-declarations', orgId, year, month, taxCode, status],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('periodYear', String(year));
      if (month) params.set('periodMonth', month);
      if (taxCode) params.set('taxCode', taxCode);
      if (status) params.set('status', status);
      params.set('limit', '200');
      return api.get(`/organizations/${orgId}/fiscal/declarations?${params.toString()}`);
    },
    enabled: orgId !== '',
  });

  const parametersQuery = useQuery<ListFiscalParametersResponse, ApiError>({
    queryKey: ['fiscal-parameters', orgId],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/fiscal/parameters?activeOnly=true`),
    enabled: orgId !== '',
  });

  const transition = useMutation<
    DeclarationEnvelope,
    ApiError,
    { id: string; targetStatus: FiscalDeclarationStatus }
  >({
    mutationFn: async ({ id, targetStatus }) =>
      api.post(`/organizations/${orgId}/fiscal/declarations/${id}/transition`, {
        targetStatus,
      }),
    onSuccess: (_data, { targetStatus }) => {
      queryClient.invalidateQueries({ queryKey: ['fiscal-declarations'] });
      toast.success(`Statut mis à jour : ${STATUS_LABELS[targetStatus]}.`);
    },
    onError: (err) => toast.error(err.message),
  });

  const generate = useMutation<
    DeclarationEnvelope,
    ApiError,
    { taxCode: string; periodYear: number; periodMonth?: number }
  >({
    mutationFn: async (payload) =>
      api.post(`/organizations/${orgId}/fiscal/declarations/generate-auto`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fiscal-declarations'] });
      toast.success('Déclaration générée.');
    },
    onError: (err) => toast.error(err.message),
  });

  // Initialise le barème CI par défaut (TVA, IS, IMF, patente, CNPS, FDFP)
  // pour l'exercice courant lorsqu'aucun taux n'est encore paramétré.
  const seedDefaults = useMutation<unknown, ApiError, number>({
    mutationFn: async (fiscalYear) =>
      api.post(`/organizations/${orgId}/fiscal/parameters/seed-defaults`, { fiscalYear }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fiscal-parameters'] });
      toast.success('Barème fiscal CI initialisé.');
    },
    onError: (err) => toast.error(err.message),
  });

  const declarations = declarationsQuery.data?.declarations ?? [];
  const parameters = parametersQuery.data?.parameters ?? [];

  // Codes d'impôt disponibles pour le filtre : union des paramètres actifs et
  // des codes déjà présents dans les déclarations chargées.
  const taxCodes = useMemo(() => {
    const set = new Set<string>();
    parameters.forEach((p) => set.add(p.taxCode));
    declarations.forEach((d) => set.add(d.taxCode));
    return Array.from(set).sort();
  }, [parameters, declarations]);

  const today = useMemo(() => startOfDay(new Date()), []);

  const kpis = useMemo(() => {
    let toFile = 0;
    let upcomingDue = 0;
    let overdue = 0;
    let paidAmount = 0;
    for (const d of declarations) {
      const due = startOfDay(new Date(d.dueDate));
      const amount = Number(d.amountDue);
      if (d.status === 'a_deposer') {
        toFile += 1;
        upcomingDue += amount;
        if (due < today) overdue += 1;
      }
      if (d.status === 'depose' && due < today) overdue += 1;
      if (d.status === 'paye') paidAmount += amount;
    }
    return { toFile, upcomingDue, overdue, paidAmount };
  }, [declarations, today]);

  // Regroupement par échéance (date due) pour le calendrier.
  const groups = useMemo(() => groupByDueDate(declarations), [declarations]);

  const isLoading = declarationsQuery.isLoading && !declarationsQuery.data;

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">États · Fiscal &amp; social</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Échéancier fiscal &amp; social
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Calendrier des échéances fiscales et sociales (IS, IMF, TVA, patente, CNPS, FDFP) avec
            suivi à faire / déposé / payé et génération des déclarations.
          </p>
        </header>

        <FilterBar
          year={year}
          month={month}
          taxCode={taxCode}
          status={status}
          taxCodes={taxCodes}
          onYear={setYear}
          onMonth={setMonth}
          onTaxCode={setTaxCode}
          onStatus={setStatus}
        />

        {isLoading ? (
          <FiscalSkeleton />
        ) : declarationsQuery.error ? (
          <div className="rounded-sm border border-critical/40 bg-critical-soft p-4">
            <FormError error={declarationsQuery.error} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Déclarations à faire"
                value={String(kpis.toFile)}
                kind="count"
                icon={FileText}
                tone="neutral"
              />
              <KpiCard
                label="Montant dû à venir"
                value={String(kpis.upcomingDue)}
                kind="amount"
                icon={CalendarClock}
                tone="warn"
              />
              <KpiCard
                label="En retard"
                value={String(kpis.overdue)}
                kind="count"
                icon={AlertTriangle}
                tone={kpis.overdue > 0 ? 'critical' : 'neutral'}
              />
              <KpiCard
                label="Déjà payé (période)"
                value={String(kpis.paidAmount)}
                kind="amount"
                icon={Wallet}
                tone="accent"
              />
            </div>

            <GenerateBar
              parameters={parameters}
              year={year}
              month={month}
              isPending={generate.isPending}
              onGenerate={(payload) => generate.mutate(payload)}
              parametersLoading={parametersQuery.isLoading}
              isSeeding={seedDefaults.isPending}
              onSeed={() => seedDefaults.mutate(year)}
            />

            {declarations.length === 0 ? (
              <EmptyState />
            ) : (
              <section className="space-y-6">
                {groups.map((group) => (
                  <DueDateGroup
                    key={group.dueDate}
                    group={group}
                    today={today}
                    onTransition={(id, targetStatus) =>
                      transition.mutate({ id, targetStatus })
                    }
                    transitionPendingId={
                      transition.isPending ? transition.variables?.id : undefined
                    }
                  />
                ))}
              </section>
            )}

            <BasesSection declarations={declarations} />
          </>
        )}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter bar
// ─────────────────────────────────────────────────────────────────────────────

interface FilterBarProps {
  year: number;
  month: string;
  taxCode: string;
  status: FiscalDeclarationStatus | '';
  taxCodes: string[];
  onYear: (v: number) => void;
  onMonth: (v: string) => void;
  onTaxCode: (v: string) => void;
  onStatus: (v: FiscalDeclarationStatus | '') => void;
}

function FilterBar({
  year,
  month,
  taxCode,
  status,
  taxCodes,
  onYear,
  onMonth,
  onTaxCode,
  onStatus,
}: FilterBarProps) {
  return (
    <section className="flex flex-wrap items-end gap-4 rounded-sm border border-line bg-paper p-4">
      <Field label="Année">
        <select
          value={year}
          onChange={(e) => onYear(Number(e.target.value))}
          className={SELECT_CLASS}
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Mois">
        <select value={month} onChange={(e) => onMonth(e.target.value)} className={SELECT_CLASS}>
          <option value="">Tous</option>
          {MONTH_LABELS.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Code impôt">
        <select
          value={taxCode}
          onChange={(e) => onTaxCode(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">Tous</option>
          {taxCodes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Statut">
        <select
          value={status}
          onChange={(e) => onStatus(e.target.value as FiscalDeclarationStatus | '')}
          className={SELECT_CLASS}
        >
          <option value="">Tous</option>
          {(Object.keys(STATUS_LABELS) as FiscalDeclarationStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate bar
// ─────────────────────────────────────────────────────────────────────────────

interface GenerateBarProps {
  parameters: FiscalParameter[];
  year: number;
  month: string;
  isPending: boolean;
  onGenerate: (payload: { taxCode: string; periodYear: number; periodMonth?: number }) => void;
  parametersLoading: boolean;
  isSeeding: boolean;
  onSeed: () => void;
}

function GenerateBar({
  parameters,
  year,
  month,
  isPending,
  onGenerate,
  parametersLoading,
  isSeeding,
  onSeed,
}: GenerateBarProps) {
  const [selected, setSelected] = useState<string>('');

  const submit = () => {
    if (!selected) return;
    const param = parameters.find((p) => p.taxCode === selected);
    // Annuel : on n'envoie pas de mois. Mensuel/trimestriel : mois requis.
    const periodMonth =
      param && param.periodicity !== 'annual' ? (month ? Number(month) : undefined) : undefined;
    onGenerate({ taxCode: selected, periodYear: year, periodMonth });
  };

  // Aucun taux paramétré : on propose d'initialiser le barème CI par défaut
  // plutôt que de masquer la fonctionnalité (action concrète, pas un cul-de-sac).
  if (!parametersLoading && parameters.length === 0) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-line bg-paper p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-warn-soft">
            <AlertTriangle className="h-4 w-4 text-warn" strokeWidth={1.5} />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">Aucun taux fiscal paramétré</p>
            <p className="mt-0.5 max-w-[60ch] text-sm text-ink-mute">
              Initialisez le barème CI par défaut (TVA, IS, IMF, patente, CNPS, FDFP) pour
              l&apos;exercice {year} afin d&apos;activer la génération automatique des déclarations.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSeed}
          disabled={isSeeding}
          className="press inline-flex h-9 items-center justify-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-canvas transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {isSeeding ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <Send className="h-4 w-4" strokeWidth={1.5} />
          )}
          Initialiser le barème {year}
        </button>
      </section>
    );
  }

  if (parameters.length === 0) return null;

  return (
    <section className="flex flex-wrap items-end gap-4 rounded-sm border border-line bg-paper p-4">
      <Field label="Générer la déclaration (base dérivée de la compta)">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className={`${SELECT_CLASS} min-w-[16rem]`}
        >
          <option value="">Choisir un impôt / une cotisation</option>
          {parameters.map((p) => (
            <option key={p.id} value={p.taxCode}>
              {p.taxCode} — {p.label}
            </option>
          ))}
        </select>
      </Field>
      <button
        type="button"
        onClick={submit}
        disabled={!selected || isPending}
        className="press inline-flex h-9 items-center justify-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-canvas transition-colors hover:bg-accent/90 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        ) : (
          <FileText className="h-4 w-4" strokeWidth={1.5} />
        )}
        Générer
      </button>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendrier — groupe par échéance
// ─────────────────────────────────────────────────────────────────────────────

interface DueGroup {
  dueDate: string;
  rows: FiscalDeclaration[];
}

function DueDateGroup({
  group,
  today,
  onTransition,
  transitionPendingId,
}: {
  group: DueGroup;
  today: Date;
  onTransition: (id: string, targetStatus: FiscalDeclarationStatus) => void;
  transitionPendingId?: string;
}) {
  const due = startOfDay(new Date(group.dueDate));
  const groupOverdue = group.rows.some(
    (d) => due < today && d.status !== 'paye' && d.status !== 'annule',
  );

  return (
    <div className="overflow-hidden rounded-sm border border-line bg-paper">
      <div className="flex items-center justify-between border-b border-line bg-sunk px-4 py-2.5">
        <div className="flex items-center gap-2">
          <CalendarClock
            className={groupOverdue ? 'h-4 w-4 text-critical-ink' : 'h-4 w-4 text-ink-mute'}
            strokeWidth={1.5}
          />
          <span className="text-sm font-medium text-ink">Échéance {formatDate(group.dueDate)}</span>
          {groupOverdue && (
            <span className="rounded-xs bg-critical-soft px-2 py-0.5 text-2xs uppercase tracking-wider text-critical-ink">
              En retard
            </span>
          )}
        </div>
        <span className="text-xs text-ink-mute">
          {group.rows.length} déclaration{group.rows.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-sunk text-xs uppercase tracking-wider text-ink-mute">
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Période</th>
              <th className="px-4 py-2 text-right font-medium">Base imposable</th>
              <th className="px-4 py-2 text-right font-medium">Taux</th>
              <th className="px-4 py-2 text-right font-medium">Montant dû</th>
              <th className="px-4 py-2 font-medium">Statut</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {group.rows.map((d) => (
              <DeclarationRow
                key={d.id}
                declaration={d}
                onTransition={onTransition}
                isPending={transitionPendingId === d.id}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeclarationRow({
  declaration: d,
  onTransition,
  isPending,
}: {
  declaration: FiscalDeclaration;
  onTransition: (id: string, targetStatus: FiscalDeclarationStatus) => void;
  isPending: boolean;
}) {
  const allowed = STATUS_TRANSITIONS[d.status];

  return (
    <tr className="group transition-colors hover:bg-sunk">
      <td className="px-4 py-2">
        <span className="font-medium text-ink">{d.taxCode}</span>
        {d.label && <span className="block text-xs text-ink-mute">{d.label}</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-ink-soft">{formatPeriod(d)}</td>
      <td className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums text-ink-soft">
        {formatAmount(Number(d.baseAmount))}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums text-ink-mute">
        {formatRate(d.rate)}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right font-mono font-medium tabular-nums text-ink">
        {formatAmount(Number(d.amountDue))}
      </td>
      <td className="px-4 py-2">
        <StatusBadge status={d.status} />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-2">
          {d.justificatifUrl && (
            <a
              href={d.justificatifUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Ouvrir le justificatif (GED)"
              className="p-1 text-ink-mute transition-colors hover:text-accent-ink"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
            </a>
          )}
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-ink-mute" strokeWidth={1.5} />
          ) : (
            allowed
              .filter((s) => s !== 'annule')
              .map((target) => (
                <button
                  key={target}
                  type="button"
                  onClick={() => onTransition(d.id, target)}
                  title={TRANSITION_LABELS[target]}
                  className="inline-flex items-center gap-1 rounded-xs border border-line px-2 py-1 text-2xs uppercase tracking-wider text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                >
                  <TransitionIcon target={target} />
                  {TRANSITION_LABELS[target]}
                </button>
              ))
          )}
        </div>
      </td>
    </tr>
  );
}

function TransitionIcon({ target }: { target: FiscalDeclarationStatus }) {
  if (target === 'depose') return <Send className="h-3 w-3" strokeWidth={1.5} />;
  if (target === 'paye') return <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />;
  return <FileText className="h-3 w-3" strokeWidth={1.5} />;
}

function StatusBadge({ status }: { status: FiscalDeclarationStatus }) {
  const cls =
    status === 'paye'
      ? 'bg-accent-soft text-accent-ink'
      : status === 'depose'
        ? 'bg-info-soft text-info'
        : status === 'a_deposer'
          ? 'bg-warn-soft text-warn'
          : 'bg-sunk text-ink-soft';
  return (
    <span
      className={`inline-block rounded-xs px-2 py-0.5 text-2xs uppercase tracking-wider ${cls}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bases déclaratives
// ─────────────────────────────────────────────────────────────────────────────

function BasesSection({ declarations }: { declarations: FiscalDeclaration[] }) {
  // La base imposable (`baseAmount`) agrégée par code d'impôt EST la base
  // déclarative attendue : base TVA = CA taxable, base CNPS = masse salariale,
  // base IS = résultat fiscal. On la présente donc telle quelle, par code, ce
  // qui sécurise les déclarations sans dupliquer un moteur fiscal.
  const byCode = useMemo(() => {
    const map = new Map<string, { label: string | null; base: number; due: number }>();
    for (const d of declarations) {
      const entry = map.get(d.taxCode) ?? { label: d.label, base: 0, due: 0 };
      entry.base += Number(d.baseAmount);
      entry.due += Number(d.amountDue);
      map.set(d.taxCode, entry);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [declarations]);

  if (byCode.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-sm border border-line bg-paper">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-display text-lg font-medium text-ink">Bases déclaratives</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Base imposable cumulée par code impôt sur la période filtrée.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-sunk text-xs uppercase tracking-wider text-ink-mute">
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Libellé</th>
              <th className="px-4 py-2 text-right font-medium">Base imposable</th>
              <th className="px-4 py-2 text-right font-medium">Montant dû</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {byCode.map(([code, info]) => (
              <tr key={code} className="transition-colors hover:bg-sunk">
                <td className="px-4 py-2 font-medium text-ink">{code}</td>
                <td className="px-4 py-2 text-ink-soft">{info.label ?? '—'}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums text-ink-soft">
                  {formatAmount(info.base)}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono font-medium tabular-nums text-ink">
                  {formatAmount(info.due)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI / empty / skeleton / helpers
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  kind,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  kind: 'count' | 'amount';
  icon: typeof FileText;
  tone: 'neutral' | 'accent' | 'warn' | 'critical';
}) {
  const num = Number(value);
  const display = kind === 'amount' ? formatAmount(num) : String(num);
  const badge =
    tone === 'accent'
      ? 'bg-accent-soft text-accent-ink'
      : tone === 'warn'
        ? 'bg-warn-soft text-warn'
        : tone === 'critical'
          ? 'bg-critical-soft text-critical-ink'
          : 'bg-sunk text-ink-soft';
  const valueColor = tone === 'critical' ? 'text-critical-ink' : 'text-ink';

  return (
    <div className="rounded-sm border border-line bg-paper p-5 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">{label}</p>
          <p className={`mt-3 font-mono text-2xl font-semibold tabular-nums ${valueColor}`}>
            {display}
          </p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-sm ${badge}`}>
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-sm border border-line bg-paper py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <CalendarClock className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <p className="mt-4 text-sm font-medium text-ink">Aucune échéance sur cette période.</p>
      <p className="mt-1 max-w-[42ch] text-sm text-ink-mute">
        Ajustez les filtres ou générez une déclaration à partir des paramètres fiscaux actifs.
      </p>
    </div>
  );
}

function FiscalSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-sm border border-line bg-paper" />
        ))}
      </div>
      <div className="h-16 rounded-sm border border-line bg-paper" />
      <div className="h-48 rounded-sm border border-line bg-paper" />
      <div className="h-48 rounded-sm border border-line bg-paper" />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-ink-mute">{label}</label>
      <div>{children}</div>
    </div>
  );
}

const SELECT_CLASS =
  'h-9 rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent';

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function groupByDueDate(declarations: FiscalDeclaration[]): DueGroup[] {
  const map = new Map<string, FiscalDeclaration[]>();
  for (const d of declarations) {
    const list = map.get(d.dueDate) ?? [];
    list.push(d);
    map.set(d.dueDate, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dueDate, rows]) => ({ dueDate, rows }));
}

function formatPeriod(d: FiscalDeclaration): string {
  if (d.periodMonth && d.periodMonth >= 1 && d.periodMonth <= 12) {
    return `${MONTH_LABELS[d.periodMonth - 1]} ${d.periodYear}`;
  }
  return `Exercice ${d.periodYear}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatRate(rate: string): string {
  const num = Number(rate);
  if (Number.isNaN(num)) return rate;
  return `${num.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
