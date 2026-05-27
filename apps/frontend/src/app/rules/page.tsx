'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Plus, TestTube } from 'lucide-react';
import { useState } from 'react';

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
  'w-full rounded-sm border border-line-strong bg-paper p-2 font-mono text-xs text-ink transition-colors focus:border-accent focus:outline-none';

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
export default function RulesPage() {
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
        void qc.invalidateQueries({ queryKey: ['rules', orgId] });
      },
    },
  );

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Automatisation</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">Règles d&apos;automatisation</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Évalue des conditions (compte, montant, journal, libellé) puis déclenche des
            actions (reclassement, centre de coûts, tag). Toujours simuler avant d&apos;appliquer.
          </p>
        </header>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Nouvelle règle</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Conditions et actions au format JSON. Voir{' '}
              <code className="rounded-sm bg-sunk px-1 py-0.5 text-xs text-ink-soft">docs/produit/module-5-rules.md</code> pour
              les variantes disponibles (account_prefix, amount_range, reclassify_account…).
            </p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-5">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(undefined);
              }}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
                <div className="space-y-1">
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
                <div className="space-y-1">
                  <Label htmlFor="r-prio">Priorité</Label>
                  <Input
                    id="r-prio"
                    type="number"
                    min="0"
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="r-desc">Description</Label>
                <Input
                  id="r-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="r-cond">Conditions (JSON)</Label>
                  <textarea
                    id="r-cond"
                    value={conditionsJson}
                    onChange={(e) => setConditionsJson(e.target.value)}
                    rows={6}
                    className={TEXTAREA_CLS}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="r-act">Actions (JSON)</Label>
                  <textarea
                    id="r-act"
                    value={actionsJson}
                    onChange={(e) => setActionsJson(e.target.value)}
                    rows={6}
                    className={TEXTAREA_CLS}
                  />
                </div>
              </div>
              <Button type="submit" disabled={create.isPending || name.trim() === ''} className="press">
                {create.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Créer
              </Button>
              <FormError error={create.error} />
            </form>
          </div>
        </section>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Règles existantes</h2>
          </div>
          {rulesQuery.isLoading ? (
            <p className="text-sm text-ink-mute">Chargement…</p>
          ) : (rulesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-mute">Aucune règle.</p>
          ) : (
            <ul className="divide-y divide-line rounded-sm border border-line bg-paper">
              {(rulesQuery.data ?? []).map((r) => (
                <RuleRow key={r.id} orgId={orgId} rule={r} />
              ))}
            </ul>
          )}
          <FormError error={rulesQuery.error} className="mt-3" />
        </section>
      </div>
    </AppShell>
  );
}

function RuleRow({ orgId, rule }: { orgId: string; rule: RuleView }) {
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

  return (
    <li className="px-3 py-2.5 text-sm transition-colors hover:bg-sunk/50">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="press flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{rule.name}</span>
            <span
              className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium ${
                rule.isActive ? 'bg-accent/15 text-accent-ink' : 'bg-sunk text-ink-mute'
              }`}
            >
              {rule.isActive ? 'Actif' : 'Inactif'}
            </span>
            <span className="text-xs text-ink-mute">priorité {rule.priority}</span>
          </div>
          {rule.description && (
            <div className="text-xs text-ink-mute">{rule.description}</div>
          )}
        </button>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={simulate.isPending}
            onClick={() => simulate.mutate(undefined)}
            className="press"
          >
            {simulate.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
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
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            Appliquer
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
          <div>
            <div className="eyebrow mb-1">conditions</div>
            <pre className="overflow-x-auto rounded-sm bg-sunk p-2 font-mono text-[11px] text-ink-soft">
              {JSON.stringify(rule.conditions, null, 2)}
            </pre>
          </div>
          <div>
            <div className="eyebrow mb-1">actions</div>
            <pre className="overflow-x-auto rounded-sm bg-sunk p-2 font-mono text-[11px] text-ink-soft">
              {JSON.stringify(rule.actions, null, 2)}
            </pre>
          </div>
        </div>
      )}
      {simResult !== null && (
        <div className="mt-2 rounded-sm border border-accent/30 bg-accent/10 p-2 text-xs">
          <div className="eyebrow mb-1 text-accent-ink">simulation result</div>
          <pre className="overflow-x-auto font-mono text-[11px] text-accent-ink">
            {JSON.stringify(simResult, null, 2)}
          </pre>
        </div>
      )}
      <FormError error={simulate.error} className="mt-2" />
      <FormError error={apply.error} className="mt-2" />
    </li>
  );
}
