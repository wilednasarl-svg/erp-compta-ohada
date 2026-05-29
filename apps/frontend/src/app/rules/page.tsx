'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Loader2,
  Play,
  Plus,
  Sparkles,
  TestTube,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

interface RuleView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly priority: number;
  readonly conditions: ReadonlyArray<Record<string, unknown>>;
  readonly actions: ReadonlyArray<Record<string, unknown>>;
  readonly createdAt: string;
}

interface ListResponse {
  readonly rules: ReadonlyArray<RuleView>;
}

const TEXTAREA_CLS =
  'w-full rounded-sm border border-line-strong bg-canvas p-3 font-mono text-xs leading-relaxed text-ink transition-colors duration-fast focus:border-accent focus:outline-none';

function SkeletonRows({ n = 4 }: { n?: number }){
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-3 w-10 rounded-xs bg-sunk" />
          <div className="h-3 flex-1 rounded-xs bg-sunk" />
          <div className="h-3 w-20 rounded-xs bg-sunk" />
          <div className="h-5 w-16 rounded-full bg-sunk" />
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
}){
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
          className="inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: 'accent' | 'warn' | 'info' | 'critical' | 'neutral';
  children: React.ReactNode;
}){
  const styles: Record<typeof tone, string> = {
    accent: 'bg-accent-soft text-accent-ink',
    warn: 'bg-warn-soft text-warn-ink',
    info: 'bg-info-soft text-info-ink',
    critical: 'bg-critical-soft text-critical-ink',
    neutral: 'bg-sunk text-ink-mute',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

function summarizeCondition(c: Record<string, unknown>): string {
  const type = String(c.type ?? 'condition');
  if (type === 'account_prefix' && typeof c.prefix === 'string') {
    return `Compte commence par ${c.prefix}`;
  }
  if (type === 'amount_range') {
    const min = c.min ?? '−∞';
    const max = c.max ?? '+∞';
    return `Montant ∈ [${min}, ${max}]`;
  }
  if (type === 'journal_code' && typeof c.code === 'string') {
    return `Journal = ${c.code}`;
  }
  if (type === 'description_contains' && typeof c.text === 'string') {
    return `Libellé contient « ${c.text} »`;
  }
  return type;
}

function summarizeAction(a: Record<string, unknown>): string {
  const type = String(a.type ?? 'action');
  if (type === 'assign_cost_center' && typeof a.costCenter === 'string') {
    return `Centre de coûts → ${a.costCenter}`;
  }
  if (type === 'reclassify_account' && typeof a.targetAccount === 'string') {
    return `Reclasser sur ${a.targetAccount}`;
  }
  if (type === 'add_tag' && typeof a.tag === 'string') {
    return `Tag : ${a.tag}`;
  }
  return type;
}

/**
 * `/rules` — moteur de règles (Module 5).
 *
 * UX MVP avec édition JSONB brut : un comptable avancé saisit
 * `conditions` et `actions` en JSON (la doc backend liste les
 * variantes : AccountPrefixCondition, AmountRangeCondition,
 * ReclassifyAccountAction, etc.). Une vraie UX builder visuel arrivera
 * en vague 2.
 *
 * Actions : `simulate` (dry-run, retourne nb matches), `apply`
 * (déclenche les transformations comptables).
 */
export default function RulesPage(){
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();

  const rulesQuery = useQuery<ReadonlyArray<RuleView>, ApiError>({
    queryKey: ['rules', orgId],
    queryFn: async () => {
      const data = await api.get<ListResponse>(`/organizations/${orgId}/rules`);
      return data.rules;
    },
    enabled: orgId !== '',
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(100);
  const [conditionsJson, setConditionsJson] = useState(
    '[\n  { "type": "account_prefix", "prefix": "62" }\n]',
  );
  const [actionsJson, setActionsJson] = useState(
    '[\n  { "type": "assign_cost_center", "costCenter": "ADMIN" }\n]',
  );

  const create = useApiMutation(
    async () => {
      let conditions: unknown;
      let actions: unknown;
      try {
        conditions = JSON.parse(conditionsJson);
        actions = JSON.parse(actionsJson);
      } catch (e) {
        throw new ApiError(422, {
          code: 'RULE_INVALID_CONDITION',
          message: `JSON invalide : ${(e as Error).message}`,
        });
      }
      return api.post(`/organizations/${orgId}/rules`, {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        priority,
        isActive: true,
        conditions,
        actions,
      });
    },
    {
      onSuccess: () => {
        setName('');
        setDescription('');
        setShowForm(false);
        void qc.invalidateQueries({ queryKey: ['rules', orgId] });
      },
    },
  );

  const rules = rulesQuery.data ?? [];
  const stats = useMemo(() => {
    const active = rules.filter((r) => r.isActive).length;
    return {
      total: rules.length,
      active,
      inactive: rules.length - active,
    };
  }, [rules]);

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        {/* Hero header */}
        <header className="flex flex-col gap-6 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow mb-2">Retraitement · Règles</p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Règles de comptabilisation
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Automatisez la comptabilisation des opérations récurrentes : une condition
              (préfixe de compte, plage de montant, libellé, journal) déclenche une action
              (reclassement, centre de coûts, étiquette). Toujours simuler avant d&apos;appliquer.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-3 rounded-sm border border-line bg-paper px-3 py-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-accent-soft">
                <Zap className="h-3.5 w-3.5 text-accent-ink" strokeWidth={1.5} />
              </span>
              <div className="text-right">
                <p className="font-mono text-sm font-medium tabular-nums text-ink">
                  {stats.active}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-ink-mute">Actives</p>
              </div>
            </div>
            <Button onClick={() => setShowForm((v) => !v)} className="press">
              {showForm ? (
                'Annuler'
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" /> Nouvelle règle
                </>
              )}
            </Button>
          </div>
        </header>

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Total</p>
            <p className="mt-2 font-display text-2xl font-medium text-ink">{stats.total}</p>
            <p className="mt-1 text-[11px] text-ink-mute">Règles configurées</p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow text-accent-ink">Actives</p>
            <p className="mt-2 font-display text-2xl font-medium text-accent-ink">
              {stats.active}
            </p>
            <p className="mt-1 text-[11px] text-ink-mute">Évaluées à chaque écriture</p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Inactives</p>
            <p className="mt-2 font-display text-2xl font-medium text-ink-mute">
              {stats.inactive}
            </p>
            <p className="mt-1 text-[11px] text-ink-mute">En brouillon ou désactivées</p>
          </div>
        </div>

        {showForm && (
          <section className="overflow-hidden rounded-sm border border-line bg-paper">
            <header className="border-b border-line px-5 py-3">
              <p className="eyebrow">Création</p>
              <h2 className="font-display text-lg font-medium text-ink">Nouvelle règle</h2>
              <p className="mt-1 text-xs text-ink-mute">
                Conditions et actions au format JSON. Voir{' '}
                <code className="rounded-sm bg-sunk px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
                  docs/produit/module-5-rules.md
                </code>{' '}
                pour les variantes disponibles.
              </p>
            </header>
            <form
              className="space-y-4 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(undefined);
              }}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor="r-name">Nom</Label>
                  <Input
                    id="r-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Reclassement charges bancaires"
                    required
                    maxLength={255}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="r-prio">Priorité</Label>
                  <Input
                    id="r-prio"
                    type="number"
                    min="0"
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                    className="font-mono tabular-nums"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-desc">Description</Label>
                <Input
                  id="r-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="À quoi sert cette règle ?"
                  maxLength={2000}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="r-cond">
                    Conditions <span className="text-ink-mute">(JSON)</span>
                  </Label>
                  <textarea
                    id="r-cond"
                    value={conditionsJson}
                    onChange={(e) => setConditionsJson(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    className={TEXTAREA_CLS}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="r-act">
                    Actions <span className="text-ink-mute">(JSON)</span>
                  </Label>
                  <textarea
                    id="r-act"
                    value={actionsJson}
                    onChange={(e) => setActionsJson(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    className={TEXTAREA_CLS}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="press"
                  onClick={() => setShowForm(false)}
                  disabled={create.isPending}
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  disabled={create.isPending || name.trim() === ''}
                  className="press"
                >
                  {create.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Créer la règle
                </Button>
              </div>
              <FormError error={create.error} />
            </form>
          </section>
        )}

        {/* Rules list */}
        <section className="overflow-hidden rounded-sm border border-line bg-paper">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <div>
              <p className="eyebrow">Catalogue</p>
              <h2 className="font-display text-lg font-medium text-ink">Règles existantes</h2>
            </div>
            <span className="font-mono text-xs tabular-nums text-ink-mute">{rules.length}</span>
          </header>
          {rulesQuery.isLoading ? (
            <SkeletonRows n={4} />
          ) : rules.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="Aucune règle configurée"
              description="Automatisez la comptabilisation des opérations récurrentes."
              actionLabel="Créer une règle"
              actionHref="#"
            />
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((r) => (
                <RuleRow key={r.id} orgId={orgId} rule={r} />
              ))}
            </ul>
          )}
          <FormError error={rulesQuery.error} className="mx-5 mb-3" />
        </section>
      </div>
    </AppShell>
  );
}

function RuleRow({ orgId, rule }: { orgId: string; rule: RuleView }){
  const [open, setOpen] = useState(false);
  const [simResult, setSimResult] = useState<unknown>(null);

  const simulate = useApiMutation(async () => {
    const data = await api.post(`/organizations/${orgId}/rules/${rule.id}/simulate`, {});
    setSimResult(data);
    return data;
  });
  const apply = useApiMutation(async () =>
    api.post(`/organizations/${orgId}/rules/${rule.id}/apply`, {}),
  );

  const conditionSummaries = rule.conditions.slice(0, 3).map(summarizeCondition);
  const actionSummaries = rule.actions.slice(0, 3).map(summarizeAction);

  return (
    <li className="transition-colors duration-fast hover:bg-sunk/30">
      <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="press group flex flex-1 items-start gap-3 text-left"
        >
          <span
            className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm transition-colors duration-fast ${
              rule.isActive
                ? 'bg-accent-soft text-accent-ink'
                : 'bg-sunk text-ink-mute'
            }`}
          >
            {open ? (
              <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-ink">{rule.name}</h3>
              {rule.isActive ? (
                <StatusChip tone="accent">
                  <CircleDot className="h-3 w-3" /> Activée
                </StatusChip>
              ) : (
                <StatusChip tone="neutral">Désactivée</StatusChip>
              )}
              <span className="font-mono text-[11px] tabular-nums text-ink-mute">
                priorité {rule.priority}
              </span>
            </div>
            {rule.description && (
              <p className="mt-1 text-xs text-ink-soft">{rule.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-soft">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-ink-mute">Si</span>
                {conditionSummaries.length === 0 ? (
                  <span className="italic text-ink-mute">aucune condition</span>
                ) : (
                  conditionSummaries.map((s, i) => (
                    <span
                      key={i}
                      className="rounded-sm border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink"
                    >
                      {s}
                    </span>
                  ))
                )}
                {rule.conditions.length > 3 && (
                  <span className="text-ink-mute">+{rule.conditions.length - 3}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-ink-mute">Alors</span>
                {actionSummaries.length === 0 ? (
                  <span className="italic text-ink-mute">aucune action</span>
                ) : (
                  actionSummaries.map((s, i) => (
                    <span
                      key={i}
                      className="rounded-sm border border-accent/30 bg-accent-soft/40 px-1.5 py-0.5 font-mono text-[10px] text-accent-ink"
                    >
                      {s}
                    </span>
                  ))
                )}
                {rule.actions.length > 3 && (
                  <span className="text-ink-mute">+{rule.actions.length - 3}</span>
                )}
              </div>
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={simulate.isPending}
            onClick={() => simulate.mutate(undefined)}
            className="press"
          >
            {simulate.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <TestTube className="mr-1 h-3 w-3" />
            )}
            Simuler
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={apply.isPending}
            onClick={() => apply.mutate(undefined)}
            className="press"
          >
            {apply.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            Appliquer
          </Button>
        </div>
      </div>
      {open && (
        <div className="grid grid-cols-1 gap-3 border-t border-line bg-sunk/30 px-5 py-4 md:grid-cols-2">
          <div>
            <p className="eyebrow mb-1.5">Conditions (JSON)</p>
            <pre className="max-h-64 overflow-auto rounded-sm border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink-soft">
              {JSON.stringify(rule.conditions, null, 2)}
            </pre>
          </div>
          <div>
            <p className="eyebrow mb-1.5">Actions (JSON)</p>
            <pre className="max-h-64 overflow-auto rounded-sm border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink-soft">
              {JSON.stringify(rule.actions, null, 2)}
            </pre>
          </div>
        </div>
      )}
      {simResult !== null && (
        <div className="mx-5 mb-4 rounded-sm border border-accent/40 bg-accent-soft/40 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <TestTube className="h-3.5 w-3.5 text-accent-ink" strokeWidth={1.5} />
            <p className="eyebrow text-accent-ink">Résultat de la simulation</p>
          </div>
          <pre className="max-h-48 overflow-auto rounded-sm bg-canvas p-2.5 font-mono text-[11px] leading-relaxed text-accent-ink">
            {JSON.stringify(simResult, null, 2)}
          </pre>
        </div>
      )}
      {(simulate.error || apply.error) && (
        <div className="mx-5 mb-3 space-y-2">
          <FormError error={simulate.error} />
          <FormError error={apply.error} />
        </div>
      )}
    </li>
  );
}
