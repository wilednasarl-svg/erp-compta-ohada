'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Package, Plus, Warehouse } from 'lucide-react';
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

type StockFamily = 'marchandises' | 'matieres' | 'fournitures' | 'en_cours' | 'produits_finis' | 'en_route';
type MovementType = 'purchase' | 'sale' | 'adjustment' | 'inventory_count';

interface ItemView {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly unitOfMeasure: string;
  readonly family: StockFamily;
  readonly stockAccountId: string;
  readonly purchaseAccountId: string;
  readonly saleAccountId: string | null;
  readonly qtyOnHand: string;
  readonly cmp: string;
  readonly isActive: boolean;
}

interface MovementView {
  readonly id: string;
  readonly itemId: string;
  readonly type: MovementType;
  readonly movementDate: string;
  readonly qty: string;
  readonly unitPrice: string | null;
  readonly cmpAfter: string;
  readonly reference: string | null;
}

const FAMILY_LABEL: Record<StockFamily, string> = {
  marchandises: 'Marchandises (31x)',
  matieres: 'Matières premières (32x)',
  fournitures: 'Fournitures (33x)',
  en_cours: 'En cours (34x)',
  produits_finis: 'Produits finis (36x)',
  en_route: 'En route (37x)',
};

const MOVEMENT_LABEL: Record<MovementType, string> = {
  purchase: 'Achat',
  sale: 'Vente',
  adjustment: 'Ajustement',
  inventory_count: 'Inventaire',
};

const MOVEMENT_TONE: Record<MovementType, string> = {
  purchase: 'bg-accent-soft text-accent-ink',
  sale: 'bg-info-soft text-info-ink',
  adjustment: 'bg-warn-soft text-warn-ink',
  inventory_count: 'bg-sunk text-ink-soft',
};

const SELECT_CLS =
  'w-full rounded-sm border border-line-strong bg-paper px-3 py-2 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none';

function fmt(n: number | string): string {
  const v = typeof n === 'string' ? Number(n) : n;
  return Number.isFinite(v) ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-3 w-20 rounded-xs bg-sunk" />
          <div className="h-3 flex-1 rounded-xs bg-sunk" />
          <div className="h-3 w-24 rounded-xs bg-sunk" />
          <div className="h-3 w-16 rounded-xs bg-sunk" />
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
  onAction,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
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
          className="inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </Link>
      )}
      {actionLabel && !actionHref && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default function InventoryPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();
  const [tab, setTab] = useState<'items' | 'movements'>('items');
  const [creatingItem, setCreatingItem] = useState(false);
  const [movementFor, setMovementFor] = useState<ItemView | null>(null);

  const itemsQuery = useQuery<ReadonlyArray<ItemView>, ApiError>({
    queryKey: ['inventory-items', orgId],
    queryFn: async () => {
      const data = await api.get<{ items: ReadonlyArray<ItemView> }>(
        `/organizations/${orgId}/inventory/items?pageSize=200`,
      );
      return data.items;
    },
    enabled: orgId !== '',
  });

  const movementsQuery = useQuery<ReadonlyArray<MovementView>, ApiError>({
    queryKey: ['inventory-movements', orgId],
    queryFn: async () => {
      const data = await api.get<{ movements: ReadonlyArray<MovementView> }>(
        `/organizations/${orgId}/inventory/movements?pageSize=200`,
      );
      return data.movements;
    },
    enabled: orgId !== '' && tab === 'movements',
  });

  const summary = useMemo(() => {
    const items = itemsQuery.data ?? [];
    const totalSkus = items.length;
    const totalValue = items.reduce((acc, it) => acc + Number(it.qtyOnHand) * Number(it.cmp), 0);
    const zeroCount = items.filter((it) => Number(it.qtyOnHand) === 0).length;
    const negativeCount = items.filter((it) => Number(it.qtyOnHand) < 0).length;
    return { totalSkus, totalValue, zeroCount, negativeCount };
  }, [itemsQuery.data]);

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">États · Inventaire</p>
            <h1 className="font-display text-4xl font-medium tracking-tight text-ink">Inventaire</h1>
            <p className="mt-2 max-w-2xl text-sm text-ink-mute">
              Suivi des stocks et inventaire physique SYSCOHADA. Valorisation au coût moyen pondéré (CMP).
            </p>
          </div>
          <Button onClick={() => setCreatingItem((v) => !v)} className="press">
            {creatingItem ? 'Annuler' : (<><Plus className="mr-2 h-4 w-4" /> Nouvel article</>)}
          </Button>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Articles (SKU)</p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-ink">{summary.totalSkus}</p>
            <p className="mt-1 text-xs text-ink-mute">fiches actives</p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Valeur du stock</p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-ink">{fmt(summary.totalValue)}</p>
            <p className="mt-1 text-xs text-ink-mute">XOF · Qté × CMP</p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Stocks nuls</p>
            <p className={`mt-1 font-mono text-2xl font-medium tabular-nums ${summary.zeroCount > 0 ? 'text-warn-ink' : 'text-ink'}`}>
              {summary.zeroCount}
            </p>
            <p className="mt-1 text-xs text-ink-mute">à réapprovisionner</p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Stocks négatifs</p>
            <p className={`mt-1 font-mono text-2xl font-medium tabular-nums ${summary.negativeCount > 0 ? 'text-critical-ink' : 'text-ink'}`}>
              {summary.negativeCount}
            </p>
            <p className="mt-1 text-xs text-ink-mute">anomalies à corriger</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-line">
          <button
            onClick={() => setTab('items')}
            className={`press border-b-2 px-4 py-2 text-sm transition-colors duration-fast ${
              tab === 'items' ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-mute hover:text-ink'
            }`}
          >
            <Package className="mr-1 inline h-4 w-4" /> Articles
          </button>
          <button
            onClick={() => setTab('movements')}
            className={`press border-b-2 px-4 py-2 text-sm transition-colors duration-fast ${
              tab === 'movements' ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-mute hover:text-ink'
            }`}
          >
            <ArrowDownToLine className="mr-1 inline h-4 w-4" /> Mouvements
          </button>
        </div>

        {creatingItem && (
          <CreateItemForm
            orgId={orgId}
            onSuccess={() => {
              setCreatingItem(false);
              void qc.invalidateQueries({ queryKey: ['inventory-items'] });
            }}
          />
        )}

        {movementFor && (
          <MovementForm
            orgId={orgId}
            item={movementFor}
            onSuccess={() => {
              setMovementFor(null);
              void qc.invalidateQueries({ queryKey: ['inventory'] });
            }}
            onCancel={() => setMovementFor(null)}
          />
        )}

        {tab === 'items' ? (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-3 border-b border-line pb-3">
              <div>
                <h2 className="font-display text-xl font-medium text-ink">Articles en stock</h2>
                <p className="mt-1 text-sm text-ink-mute">
                  {itemsQuery.data?.length ?? 0} fiche{(itemsQuery.data?.length ?? 0) > 1 ? 's' : ''}
                </p>
              </div>
            </div>
            {itemsQuery.isLoading ? (
              <div className="rounded-sm border border-line">
                <SkeletonRows n={6} />
              </div>
            ) : itemsQuery.data?.length === 0 ? (
              <div className="rounded-sm border border-line bg-paper">
                <EmptyState
                  icon={Warehouse}
                  title="Aucun article en stock"
                  description="Importez ou saisissez vos premières fiches de stock"
                  actionLabel="Créer un article"
                  onAction={() => setCreatingItem(true)}
                />
              </div>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-line bg-paper">
                <table className="w-full text-sm">
                  <thead className="bg-sunk">
                    <tr>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Code</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Désignation</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Famille</span></th>
                      <th className="px-3 py-2 text-right"><span className="eyebrow">Quantité</span></th>
                      <th className="px-3 py-2 text-right"><span className="eyebrow">CMP</span></th>
                      <th className="px-3 py-2 text-right"><span className="eyebrow">Valeur</span></th>
                      <th className="px-3 py-2 text-right"><span className="eyebrow">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsQuery.data?.map((it, idx) => {
                      const qty = Number(it.qtyOnHand);
                      const cmp = Number(it.cmp);
                      const value = qty * cmp;
                      const qtyTone =
                        qty < 0 ? 'text-critical-ink' : qty === 0 ? 'text-warn-ink' : 'text-ink';
                      return (
                        <tr
                          key={it.id}
                          className={`border-t border-line transition-colors duration-fast hover:bg-sunk/50 ${idx % 2 === 1 ? 'bg-sunk/20' : ''}`}
                        >
                          <td className="px-3 py-2 font-mono text-ink">{it.code}</td>
                          <td className="px-3 py-2 text-ink">{it.label}</td>
                          <td className="px-3 py-2 text-xs text-ink-mute">{FAMILY_LABEL[it.family]}</td>
                          <td className={`num px-3 py-2 text-right font-mono tabular-nums ${qtyTone}`}>
                            <span className="inline-flex items-center justify-end gap-2">
                              {qty === 0 && (
                                <span className="inline-flex items-center rounded-xs bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn-ink">
                                  Stock nul
                                </span>
                              )}
                              {qty < 0 && (
                                <span className="inline-flex items-center rounded-xs bg-critical-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-critical-ink">
                                  Négatif
                                </span>
                              )}
                              <span>{fmt(qty)} <span className="text-ink-mute">{it.unitOfMeasure}</span></span>
                            </span>
                          </td>
                          <td className="num px-3 py-2 text-right font-mono tabular-nums text-ink-soft">
                            {fmt(cmp)}
                          </td>
                          <td className="num px-3 py-2 text-right font-mono font-medium tabular-nums text-ink">
                            {fmt(value)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button size="sm" variant="outline" onClick={() => setMovementFor(it)} className="press">
                              <ArrowUpFromLine className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {(itemsQuery.data?.length ?? 0) > 0 && (
                    <tfoot className="border-t-2 border-line-strong bg-sunk">
                      <tr>
                        <td colSpan={5} className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-soft">
                          Total valeur stock
                        </td>
                        <td className="num px-3 py-2 text-right font-mono text-base font-medium tabular-nums text-ink">
                          {fmt(summary.totalValue)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
            <FormError error={itemsQuery.error} />
          </section>
        ) : (
          <section className="space-y-4">
            <div className="border-b border-line pb-3">
              <h2 className="font-display text-xl font-medium text-ink">Historique des mouvements</h2>
              <p className="mt-1 text-sm text-ink-mute">
                {movementsQuery.data?.length ?? 0} mouvement{(movementsQuery.data?.length ?? 0) > 1 ? 's' : ''}
              </p>
            </div>
            {movementsQuery.isLoading ? (
              <div className="rounded-sm border border-line">
                <SkeletonRows n={6} />
              </div>
            ) : movementsQuery.data?.length === 0 ? (
              <div className="rounded-sm border border-line bg-paper">
                <EmptyState
                  icon={ArrowDownToLine}
                  title="Aucun mouvement enregistré"
                  description="Les entrées, sorties et inventaires apparaîtront ici dès la première saisie"
                />
              </div>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-line bg-paper">
                <table className="w-full text-sm">
                  <thead className="bg-sunk">
                    <tr>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Date</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Type</span></th>
                      <th className="px-3 py-2 text-right"><span className="eyebrow">Quantité</span></th>
                      <th className="px-3 py-2 text-right"><span className="eyebrow">Prix unitaire</span></th>
                      <th className="px-3 py-2 text-right"><span className="eyebrow">CMP après</span></th>
                      <th className="px-3 py-2 text-left"><span className="eyebrow">Référence</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementsQuery.data?.map((m, idx) => (
                      <tr
                        key={m.id}
                        className={`border-t border-line transition-colors duration-fast hover:bg-sunk/50 ${idx % 2 === 1 ? 'bg-sunk/20' : ''}`}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-ink-soft">{m.movementDate}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium ${MOVEMENT_TONE[m.type]}`}>
                            {MOVEMENT_LABEL[m.type]}
                          </span>
                        </td>
                        <td className="num px-3 py-2 text-right font-mono tabular-nums text-ink">{fmt(m.qty)}</td>
                        <td className="num px-3 py-2 text-right font-mono tabular-nums text-ink-soft">
                          {m.unitPrice ? fmt(m.unitPrice) : '—'}
                        </td>
                        <td className="num px-3 py-2 text-right font-mono tabular-nums text-ink">{fmt(m.cmpAfter)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-mute">{m.reference ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <FormError error={movementsQuery.error} />
          </section>
        )}
      </div>
    </AppShell>
  );
}

function CreateItemForm({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [family, setFamily] = useState<StockFamily>('marchandises');
  const [unit, setUnit] = useState('unit');
  const [stockAccountId, setStockAccountId] = useState('');
  const [purchaseAccountId, setPurchaseAccountId] = useState('');
  const [saleAccountId, setSaleAccountId] = useState('');

  const mut = useApiMutation(async () => {
    return api.post(`/organizations/${orgId}/inventory/items`, {
      code,
      label,
      family,
      unitOfMeasure: unit,
      stockAccountId,
      purchaseAccountId,
      saleAccountId: saleAccountId.length > 0 ? saleAccountId : undefined,
    });
  });

  async function handle(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await mut.mutateAsync(undefined);
    onSuccess();
  }

  return (
    <section className="space-y-4">
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">Nouvel article</h2>
      </div>
      <div className="rounded-sm border border-line bg-paper p-5">
        <form onSubmit={handle} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="i-code">Code SKU</Label>
            <Input id="i-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SKU-001" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-label">Désignation</Label>
            <Input id="i-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-family">Famille</Label>
            <select
              id="i-family"
              className={SELECT_CLS}
              value={family}
              onChange={(e) => setFamily(e.target.value as StockFamily)}
            >
              {(['marchandises', 'matieres', 'fournitures', 'en_cours', 'produits_finis', 'en_route'] as const).map((f) => (
                <option key={f} value={f}>{FAMILY_LABEL[f]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-unit">Unité</Label>
            <Input id="i-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unit, kg, m..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-stock">ID compte stock (31x)</Label>
            <Input id="i-stock" value={stockAccountId} onChange={(e) => setStockAccountId(e.target.value)} placeholder="UUID" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-purch">ID compte achat (60x)</Label>
            <Input id="i-purch" value={purchaseAccountId} onChange={(e) => setPurchaseAccountId(e.target.value)} placeholder="UUID" required />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="i-sale">ID compte vente (70x) — optionnel</Label>
            <Input id="i-sale" value={saleAccountId} onChange={(e) => setSaleAccountId(e.target.value)} placeholder="UUID" />
          </div>
          {mut.isError && <div className="md:col-span-2"><FormError error={mut.error} /></div>}
          <div className="md:col-span-2">
            <Button type="submit" disabled={mut.isPending} className="press">
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Créer l&apos;article
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function MovementForm({ orgId, item, onSuccess, onCancel }: {
  orgId: string;
  item: ItemView;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<MovementType>('purchase');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [reference, setReference] = useState('');

  const mut = useApiMutation(async () => {
    return api.post(`/organizations/${orgId}/inventory/items/${item.id}/movements`, {
      type,
      movementDate: date,
      qty,
      unitPrice: unitPrice.length > 0 ? unitPrice : undefined,
      reference: reference.length > 0 ? reference : undefined,
    });
  });

  async function handle(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await mut.mutateAsync(undefined);
    onSuccess();
  }

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 className="font-display text-xl font-medium text-ink">Mouvement — {item.code}</h2>
          <p className="mt-1 text-sm text-ink-mute">
            {item.label} · Stock : <span className="font-mono tabular-nums">{fmt(item.qtyOnHand)}</span> {item.unitOfMeasure} · CMP : <span className="font-mono tabular-nums">{fmt(item.cmp)}</span>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel} className="press">×</Button>
      </div>
      <div className="rounded-sm border border-line bg-paper p-5">
        <form onSubmit={handle} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="m-type">Type</Label>
            <select
              id="m-type"
              className={SELECT_CLS}
              value={type}
              onChange={(e) => setType(e.target.value as MovementType)}
            >
              <option value="purchase">Achat (entrée chiffrée)</option>
              <option value="sale">Vente (sortie au CMP)</option>
              <option value="adjustment">Ajustement</option>
              <option value="inventory_count">Inventaire physique</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-date">Date</Label>
            <Input id="m-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-qty">Quantité</Label>
            <Input id="m-qty" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="100.00" required />
          </div>
          {(type === 'purchase' || type === 'adjustment') && (
            <div className="space-y-1.5">
              <Label htmlFor="m-price">Prix unitaire</Label>
              <Input id="m-price" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="5000.00" />
            </div>
          )}
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="m-ref">Référence</Label>
            <Input id="m-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="FACT-2026-042" />
          </div>
          {mut.isError && <div className="md:col-span-2"><FormError error={mut.error} /></div>}
          <div className="md:col-span-2">
            <Button type="submit" disabled={mut.isPending} className="press">
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer le mouvement
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
