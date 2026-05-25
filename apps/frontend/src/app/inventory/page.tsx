'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Package, Plus, Settings } from 'lucide-react';
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

const MOVEMENT_COLOR: Record<MovementType, string> = {
  purchase: 'bg-emerald-100 text-emerald-900',
  sale: 'bg-blue-100 text-blue-900',
  adjustment: 'bg-amber-100 text-amber-900',
  inventory_count: 'bg-slate-200 text-slate-700',
};

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

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Inventaire & Stock</h1>
            <p className="text-sm text-muted-foreground">
              Registre articles + mouvements + valorisation Coût Moyen Pondéré (CMP) SYSCOHADA.
            </p>
          </div>
          <Button onClick={() => setCreatingItem((v) => !v)}>
            {creatingItem ? 'Annuler' : <><Plus className="mr-2 h-4 w-4" /> Nouvel article</>}
          </Button>
        </div>

        <div className="flex gap-2 border-b">
          <button
            onClick={() => setTab('items')}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === 'items' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
          >
            <Package className="inline h-4 w-4 mr-1" /> Articles
          </button>
          <button
            onClick={() => setTab('movements')}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === 'movements' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
          >
            <ArrowDownToLine className="inline h-4 w-4 mr-1" /> Mouvements
          </button>
        </div>

        {creatingItem && <CreateItemForm orgId={orgId} onSuccess={() => { setCreatingItem(false); void qc.invalidateQueries({ queryKey: ['inventory-items'] }); }} />}

        {movementFor && <MovementForm orgId={orgId} item={movementFor} onSuccess={() => { setMovementFor(null); void qc.invalidateQueries({ queryKey: ['inventory'] }); }} onCancel={() => setMovementFor(null)} />}

        {tab === 'items' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Articles en stock</CardTitle>
              <CardDescription>{itemsQuery.data?.length ?? 0} articles</CardDescription>
            </CardHeader>
            <CardContent>
              {itemsQuery.isLoading ? (
                <div className="py-8 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
              ) : itemsQuery.data?.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">Aucun article.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-muted-foreground">
                      <tr>
                        <th className="text-left py-2 px-2">Code</th>
                        <th className="text-left py-2 px-2">Désignation</th>
                        <th className="text-left py-2 px-2">Famille</th>
                        <th className="text-right py-2 px-2">Qté</th>
                        <th className="text-right py-2 px-2">CMP</th>
                        <th className="text-right py-2 px-2">Valeur</th>
                        <th className="text-right py-2 px-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsQuery.data?.map((it) => (
                        <tr key={it.id} className="border-b last:border-0">
                          <td className="py-2 px-2 font-mono">{it.code}</td>
                          <td className="py-2 px-2">{it.label}</td>
                          <td className="py-2 px-2 text-xs">{FAMILY_LABEL[it.family]}</td>
                          <td className="py-2 px-2 text-right font-mono">{Number(it.qtyOnHand).toFixed(2)} {it.unitOfMeasure}</td>
                          <td className="py-2 px-2 text-right font-mono">{Number(it.cmp).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right font-mono">
                            {new Intl.NumberFormat('fr-FR').format(Number(it.qtyOnHand) * Number(it.cmp))}
                          </td>
                          <td className="py-2 px-2 text-right">
                            <Button size="sm" variant="outline" onClick={() => setMovementFor(it)}>
                              <ArrowUpFromLine className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historique des mouvements</CardTitle>
            </CardHeader>
            <CardContent>
              {movementsQuery.isLoading ? (
                <div className="py-8 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
              ) : movementsQuery.data?.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">Aucun mouvement.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-muted-foreground">
                      <tr>
                        <th className="text-left py-2 px-2">Date</th>
                        <th className="text-left py-2 px-2">Type</th>
                        <th className="text-right py-2 px-2">Quantité</th>
                        <th className="text-right py-2 px-2">Prix unitaire</th>
                        <th className="text-right py-2 px-2">CMP après</th>
                        <th className="text-left py-2 px-2">Réf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movementsQuery.data?.map((m) => (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="py-2 px-2">{m.movementDate}</td>
                          <td className="py-2 px-2"><Badge className={MOVEMENT_COLOR[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge></td>
                          <td className="py-2 px-2 text-right font-mono">{m.qty}</td>
                          <td className="py-2 px-2 text-right font-mono">{m.unitPrice ?? '—'}</td>
                          <td className="py-2 px-2 text-right font-mono">{m.cmpAfter}</td>
                          <td className="py-2 px-2 font-mono text-xs">{m.reference ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
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
    <Card>
      <CardHeader><CardTitle className="text-base">Nouvel article</CardTitle></CardHeader>
      <CardContent>
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
            <select id="i-family" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={family} onChange={(e) => setFamily(e.target.value as StockFamily)}>
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
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Créer l'article
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function MovementForm({ orgId, item, onSuccess, onCancel }: { orgId: string; item: ItemView; onSuccess: () => void; onCancel: () => void }) {
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Mouvement — {item.code}</CardTitle>
          <Button size="sm" variant="ghost" onClick={onCancel}>×</Button>
        </div>
        <CardDescription>{item.label} · Stock: {item.qtyOnHand} {item.unitOfMeasure} · CMP: {item.cmp}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handle} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="m-type">Type</Label>
            <select id="m-type" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value as MovementType)}>
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
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer le mouvement
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
