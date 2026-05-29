'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountView } from '@/types/accounting-plan';

interface ListResponse {
  readonly accounts: ReadonlyArray<AccountView>;
}

type AccountClass = AccountView['class'];

/**
 * Intitulés officiels des classes du plan SYSCOHADA. Servent d'ancrage de
 * compréhension : un junior retrouve « où il est » dans le plan sans
 * décoder le premier chiffre du code.
 */
const CLASS_LABELS: Record<number, string> = {
  1: 'Ressources durables',
  2: 'Actif immobilisé',
  3: 'Stocks',
  4: 'Tiers',
  5: 'Trésorerie',
  6: 'Charges des activités ordinaires',
  7: 'Produits des activités ordinaires',
  8: 'Autres charges et produits (HAO)',
  9: 'Comptabilité analytique et engagements',
};

/**
 * `/chart-of-accounts` — plan comptable SYSCOHADA de l'organisation active.
 *
 * Référentiel d'abord *consulté* : la lecture (groupée par classe, navigable)
 * prime, la création de sous-comptes est en divulgation progressive. La
 * visibilité des contrôles d'écriture n'est PAS gatée côté client — le backend
 * reste la source de vérité et renvoie un 403 propre sur tentative interdite.
 */
export default function ChartOfAccountsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const queryClient = useQueryClient();

  const accountsQuery = useQuery<ReadonlyArray<AccountView>, ApiError>({
    queryKey: ['chart-of-accounts', orgId],
    queryFn: async () => {
      const data = await api.get<ListResponse>(`/organizations/${orgId}/chart-of-accounts`);
      return data.accounts;
    },
    enabled: orgId !== '',
  });

  const [search, setSearch] = useState('');
  const isSearching = search.trim() !== '';

  const filtered = useMemo<ReadonlyArray<AccountView>>(() => {
    const rows = accountsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter(
      (r) => r.code.toLowerCase().includes(q) || r.label.toLowerCase().includes(q),
    );
  }, [accountsQuery.data, search]);

  /** Comptes groupés par classe, classes ordonnées, lignes triées par code. */
  const byClass = useMemo<ReadonlyArray<readonly [AccountClass, ReadonlyArray<AccountView>]>>(() => {
    const groups = new Map<AccountClass, AccountView[]>();
    for (const acc of filtered) {
      const bucket = groups.get(acc.class) ?? [];
      bucket.push(acc);
      groups.set(acc.class, bucket);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cls, rows]) => [cls, rows.sort((x, y) => x.code.localeCompare(y.code))] as const);
  }, [filtered]);

  const presentClasses = useMemo(() => byClass.map(([cls]) => cls), [byClass]);

  // ─── Création (divulgation progressive) ─────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [createParentCode, setCreateParentCode] = useState('');
  const [createCode, setCreateCode] = useState('');
  const [createLabel, setCreateLabel] = useState('');

  const createAccount = useApiMutation(
    async () => {
      const data = await api.post<{ account: AccountView }>(
        `/organizations/${orgId}/chart-of-accounts`,
        { parentCode: createParentCode, code: createCode, label: createLabel },
      );
      return data.account;
    },
    {
      onSuccess: () => {
        setCreateParentCode('');
        setCreateCode('');
        setCreateLabel('');
        setShowCreate(false);
        void queryClient.invalidateQueries({ queryKey: ['chart-of-accounts', orgId] });
      },
    },
  );

  const deleteAccount = useApiMutation(
    async (accountId: string) => {
      await api.delete<void>(`/organizations/${orgId}/chart-of-accounts/${accountId}`);
    },
    {
      onSettled: () => queryClient.invalidateQueries({ queryKey: ['chart-of-accounts', orgId] }),
    },
  );

  if (orgId === '') {
    return (
      <AppShell>
        <EmptyHint
          title="Aucune organisation sélectionnée"
          hint="Choisissez un dossier dans le sélecteur d'organisation pour consulter son plan comptable."
        />
      </AppShell>
    );
  }

  const total = accountsQuery.data?.length ?? 0;

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        {/* ─── En-tête ─────────────────────────────────────────── */}
        <header className="border-b border-line pb-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow mb-2">Référentiel</p>
              <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
                Plan comptable
              </h1>
              <p className="mt-2 max-w-prose text-sm text-ink-soft">
                Plan SYSCOHADA AUDCIF du dossier, regroupé par classe. Les comptes de référence
                sont pré-chargés ; ajoutez vos sous-comptes auxiliaires si besoin.
              </p>
            </div>
            <Button
              type="button"
              variant={showCreate ? 'secondary' : 'default'}
              className="press shrink-0"
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? (
                <>
                  <X className="mr-2 size-4" strokeWidth={1.5} />
                  Fermer
                </>
              ) : (
                <>
                  <Plus className="mr-2 size-4" strokeWidth={1.5} />
                  Sous-compte
                </>
              )}
            </Button>
          </div>
        </header>

        {/* ─── Création (progressive) ──────────────────────────── */}
        {showCreate && (
          <section className="rounded-md border border-line bg-paper p-5">
            <h2 className="font-display text-lg font-medium text-ink">Ajouter un sous-compte</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Le code doit commencer par celui du parent et être plus long — parent{' '}
              <code className="rounded-xs bg-sunk px-1 font-mono text-ink">411</code> → enfant{' '}
              <code className="rounded-xs bg-sunk px-1 font-mono text-ink">41100001</code>.
            </p>
            <form
              className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                createAccount.mutate(undefined);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="parentCode">Compte parent</Label>
                <Input
                  id="parentCode"
                  placeholder="411"
                  value={createParentCode}
                  onChange={(e) => setCreateParentCode(e.target.value)}
                  required
                  inputMode="numeric"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="code">Code du compte</Label>
                <Input
                  id="code"
                  placeholder="41100001"
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  required
                  inputMode="numeric"
                  pattern="\d{2,10}"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="label">Libellé</Label>
                <Input
                  id="label"
                  placeholder="Client SOTRA"
                  value={createLabel}
                  onChange={(e) => setCreateLabel(e.target.value)}
                  required
                />
              </div>
              <div className="md:col-span-4">
                <Button type="submit" disabled={createAccount.isPending} className="press">
                  <Plus className="mr-2 size-4" strokeWidth={1.5} />
                  {createAccount.isPending ? 'Création…' : 'Créer le sous-compte'}
                </Button>
                {createAccount.error !== null && (
                  <FormError
                    className="mt-2"
                    error={{
                      code: createAccount.error.code,
                      message: mapCreateError(createAccount.error),
                    }}
                  />
                )}
              </div>
            </form>
          </section>
        )}

        {/* ─── Barre de recherche + navigation par classe ──────── */}
        <div className="sticky top-0 z-10 -mx-1 space-y-3 bg-canvas/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[16rem] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-mute"
                strokeWidth={1.5}
              />
              <Input
                placeholder="Rechercher par code ou libellé…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Rechercher un compte"
              />
            </div>
            <p className="text-xs text-ink-mute">
              {isSearching ? (
                <>
                  <span className="font-medium text-ink">{filtered.length}</span> résultat
                  {filtered.length > 1 ? 's' : ''} sur {total}
                </>
              ) : (
                <>
                  <span className="font-medium text-ink">{total}</span> comptes
                </>
              )}
            </p>
          </div>

          {!isSearching && presentClasses.length > 0 && (
            <nav className="flex flex-wrap gap-1.5" aria-label="Aller à une classe">
              {presentClasses.map((cls) => (
                <a
                  key={cls}
                  href={`#classe-${cls}`}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors duration-fast hover:border-line-strong hover:text-ink"
                >
                  <span className="font-mono font-medium text-ink">{cls}</span>
                  <span className="hidden sm:inline">{CLASS_LABELS[cls]}</span>
                </a>
              ))}
            </nav>
          )}
        </div>

        {/* ─── Contenu ─────────────────────────────────────────── */}
        {accountsQuery.isLoading ? (
          <ChartSkeleton />
        ) : accountsQuery.error !== null ? (
          <FormError
            error={{ code: accountsQuery.error.code, message: accountsQuery.error.message }}
          />
        ) : total === 0 ? (
          <EmptyHint
            title="Plan comptable vide"
            hint="Le plan SYSCOHADA AUDCIF est normalement pré-chargé à la création du dossier. Si rien ne s'affiche, vérifiez l'initialisation du dossier."
          />
        ) : filtered.length === 0 ? (
          <EmptyHint
            title="Aucun compte ne correspond"
            hint={`Aucun compte ne contient « ${search.trim()} » dans son code ou son libellé.`}
            action={
              <Button variant="secondary" size="sm" className="press" onClick={() => setSearch('')}>
                Effacer la recherche
              </Button>
            }
          />
        ) : (
          <div className="space-y-10">
            {byClass.map(([cls, rows]) => (
              <section key={cls} id={`classe-${cls}`} className="scroll-mt-24">
                <div className="mb-3 flex items-baseline gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-ink font-mono text-sm font-medium text-paper">
                    {cls}
                  </span>
                  <h2 className="font-display text-lg font-medium text-ink">
                    Classe {cls} — {CLASS_LABELS[cls] ?? 'Comptes'}
                  </h2>
                  <span className="text-xs text-ink-mute">
                    {rows.length} compte{rows.length > 1 ? 's' : ''}
                  </span>
                </div>
                <AccountTable
                  rows={rows}
                  onDelete={(acc) => {
                    if (
                      window.confirm(`Supprimer le compte ${acc.code} — ${acc.label} ?`)
                    ) {
                      deleteAccount.mutate(acc.id);
                    }
                  }}
                  deleting={deleteAccount.isPending}
                />
              </section>
            ))}
            {deleteAccount.error !== null && (
              <FormError
                error={{
                  code: deleteAccount.error.code,
                  message:
                    deleteAccount.error.code === 'CHART_ACCOUNT_NOT_DELETABLE'
                      ? 'Ce compte ne peut pas être supprimé (compte de référence, ou il a des sous-comptes actifs).'
                      : deleteAccount.error.message,
                }}
              />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ─── Table d'une classe ─────────────────────────────────────────── */

function AccountTable({
  rows,
  onDelete,
  deleting,
}: {
  rows: ReadonlyArray<AccountView>;
  onDelete: (account: AccountView) => void;
  deleting: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-strong bg-sunk text-left">
            <th className="px-3 py-2 font-normal"><span className="eyebrow">Code</span></th>
            <th className="px-3 py-2 font-normal"><span className="eyebrow">Libellé</span></th>
            <th className="px-3 py-2 font-normal"><span className="eyebrow">Nature</span></th>
            <th className="px-3 py-2 text-center font-normal"><span className="eyebrow">Sens</span></th>
            <th className="px-3 py-2 font-normal"><span className="eyebrow">Repères</span></th>
            <th className="w-10 px-3 py-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((acc) => {
            const isPosting = acc.accountType === 'POSTING';
            return (
              <tr
                key={acc.id}
                className={cn(
                  'border-b border-line last:border-0 transition-colors duration-fast hover:bg-sunk/50',
                  !acc.isActive && 'text-ink-mute',
                )}
              >
                <td className="px-3 py-2 font-mono tabular-nums text-ink">{acc.code}</td>
                <td className="px-3 py-2">
                  <span className={cn(isPosting ? 'text-ink' : 'font-medium text-ink')}>
                    {acc.label}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {isPosting ? (
                    <span className="inline-flex items-center rounded-xs bg-accent-soft px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-accent-ink">
                      Imputable
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-xs bg-sunk px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-ink-mute">
                      Regroupement
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs text-ink-soft">
                  {acc.normalBalance === 'D' ? 'Débit' : 'Crédit'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {acc.isCustom && (
                      <span className="inline-flex items-center rounded-xs border border-line-strong px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-ink-soft">
                        Personnalisé
                      </span>
                    )}
                    {!acc.isActive && (
                      <span className="inline-flex items-center rounded-xs bg-critical-soft px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-critical-ink">
                        Désactivé
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  {acc.isCustom && isPosting && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="press text-ink-mute hover:text-critical"
                      disabled={deleting}
                      aria-label={`Supprimer le compte ${acc.code}`}
                      onClick={() => onDelete(acc)}
                    >
                      <Trash2 className="size-4" strokeWidth={1.5} />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── États vides / chargement ───────────────────────────────────── */

function EmptyHint({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-line bg-paper px-6 py-12 text-center">
      <p className="font-display text-lg font-medium text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-mute">{hint}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="space-y-10" aria-hidden>
      {[0, 1].map((s) => (
        <div key={s} className="space-y-3">
          <div className="h-5 w-56 rounded-xs bg-sunk" />
          <div className="overflow-hidden rounded-md border border-line">
            {[0, 1, 2, 3, 4].map((r) => (
              <div key={r} className="flex items-center gap-4 border-b border-line px-3 py-2.5 last:border-0">
                <div className="h-3.5 w-16 rounded-xs bg-sunk" />
                <div className="h-3.5 flex-1 rounded-xs bg-sunk" />
                <div className="h-3.5 w-20 rounded-xs bg-sunk" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Mapping d'erreurs de création ──────────────────────────────── */

function mapCreateError(error: ApiError): string {
  switch (error.code) {
    case 'CHART_ACCOUNT_INVALID_CODE':
      return 'Le code doit contenir 2 à 10 chiffres.';
    case 'CHART_ACCOUNT_INVALID_PARENT':
      return 'Le code doit commencer par celui du parent (existant et actif) et être plus long.';
    case 'CHART_ACCOUNT_CODE_TAKEN':
      return 'Ce code est déjà utilisé dans le plan de cette organisation.';
    case 'FORBIDDEN_PERMISSION':
      return "Votre rôle ne permet pas de créer des sous-comptes (réservé à l'admin, l'expert-comptable et le chef de mission).";
    default:
      return error.message;
  }
}
