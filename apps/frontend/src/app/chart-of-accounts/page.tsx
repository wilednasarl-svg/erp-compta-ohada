'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

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
import type { AccountView } from '@/types/accounting-plan';

interface ListResponse {
  readonly accounts: ReadonlyArray<AccountView>;
}

/**
 * `/chart-of-accounts` — tenant-scoped chart of accounts for the
 * currently selected organisation.
 *
 * MVP UX:
 *   - flat ordered list (the backend already returns it ordered by
 *     code; a real arborescence rendering can come later — for now the
 *     code column makes the hierarchy visually obvious thanks to the
 *     digit prefixes);
 *   - search box that filters by code OR label substring (client-side
 *     — the chart caps around 800 rows so filtering in JS is fine);
 *   - "+ Sous-compte" form for the inline-create path (admin /
 *     expert_comptable / chef_mission only; the backend returns
 *     FORBIDDEN_PERMISSION on a Comptable / Auditeur attempt);
 *   - per-row trash button that triggers `DELETE` and surfaces the
 *     409 `CHART_ACCOUNT_NOT_DELETABLE` inline.
 *
 * Visibility is intentionally NOT gated by role on the client: the
 * backend is the source of truth. A user without write permission
 * will see the inputs but get a clean 403 on submit, which is more
 * honest than hiding controls and creating discoverability gaps.
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

  const filtered = useMemo<ReadonlyArray<AccountView>>(() => {
    const rows = accountsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') {
      return rows;
    }
    return rows.filter(
      (r) => r.code.toLowerCase().includes(q) || r.label.toLowerCase().includes(q),
    );
  }, [accountsQuery.data, search]);

  // ─── Create form ────────────────────────────────────────────────────
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
        <div className="py-12 text-center text-muted-foreground">
          Sélectionnez une organisation pour voir son plan comptable.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Plan comptable</h1>
          <p className="text-sm text-muted-foreground">
            Plan SYSCOHADA AUDCIF de l&apos;organisation — référentiel + sous-comptes personnalisés.
          </p>
        </div>

        {/* Inline create */}
        <Card>
          <CardHeader>
            <CardTitle>Ajouter un sous-compte</CardTitle>
            <CardDescription>
              Le code doit commencer par celui du parent et être plus long (ex : parent
              <code className="mx-1 rounded bg-muted px-1">411</code> → enfant
              <code className="mx-1 rounded bg-muted px-1">41100001</code>).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                createAccount.mutate(undefined);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="parentCode">Parent</Label>
                <Input
                  id="parentCode"
                  placeholder="411"
                  value={createParentCode}
                  onChange={(e) => setCreateParentCode(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  placeholder="41100001"
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  required
                  inputMode="numeric"
                  pattern="\d{2,10}"
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
                <Button type="submit" disabled={createAccount.isPending}>
                  <Plus className="mr-2 size-4" />
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
          </CardContent>
        </Card>

        {/* List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>
                  Comptes
                  {accountsQuery.data !== undefined && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({accountsQuery.data.length} total
                      {filtered.length !== accountsQuery.data.length
                        ? `, ${filtered.length} affichés`
                        : ''}
                      )
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  <Badge variant="outline" className="mr-2">
                    TITLE
                  </Badge>
                  = compte de regroupement (non mouvementable).
                  <Badge variant="outline" className="mx-2">
                    POSTING
                  </Badge>
                  = compte terminal (cible d&apos;écriture).
                </CardDescription>
              </div>
              <Input
                placeholder="Rechercher (code ou libellé)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
            </div>
          </CardHeader>
          <CardContent>
            {accountsQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            )}
            {accountsQuery.error !== null && (
              <FormError
                error={{
                  code: accountsQuery.error.code,
                  message: accountsQuery.error.message,
                }}
              />
            )}
            {accountsQuery.data !== undefined && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2">Code</th>
                      <th className="px-2 py-2">Libellé</th>
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Sens</th>
                      <th className="px-2 py-2">Source</th>
                      <th className="px-2 py-2">État</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((account) => (
                      <tr
                        key={account.id}
                        className={
                          account.isActive ? 'border-b' : 'border-b text-muted-foreground'
                        }
                      >
                        <td className="px-2 py-2 font-mono">{account.code}</td>
                        <td className="px-2 py-2">{account.label}</td>
                        <td className="px-2 py-2">
                          <Badge
                            variant={account.accountType === 'TITLE' ? 'secondary' : 'outline'}
                          >
                            {account.accountType}
                          </Badge>
                        </td>
                        <td className="px-2 py-2">{account.normalBalance}</td>
                        <td className="px-2 py-2">
                          {account.isCustom ? (
                            <Badge variant="default">Personnalisé</Badge>
                          ) : (
                            <Badge variant="outline">Référence</Badge>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {account.isActive ? 'Actif' : 'Désactivé'}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {account.isCustom && account.accountType === 'POSTING' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={deleteAccount.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Supprimer le compte ${account.code} — ${account.label} ?`,
                                  )
                                ) {
                                  deleteAccount.mutate(account.id);
                                }
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {deleteAccount.error !== null && (
                  <FormError
                    className="mt-2"
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
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

/**
 * Localised mapping of the most common create errors. Other codes fall
 * back to the backend message — those are either developer mistakes or
 * an undocumented edge case worth reading raw.
 */
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
