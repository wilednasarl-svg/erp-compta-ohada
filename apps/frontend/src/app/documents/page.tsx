'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
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
import { ApiError, api, getAuthToken } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type OcrStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

interface DocumentView {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256Checksum: string;
  readonly tags: ReadonlyArray<string>;
  readonly description: string | null;
  readonly ocrStatus: OcrStatus;
  readonly uploadedAt: string;
}
interface ListResponse {
  readonly rows: ReadonlyArray<DocumentView>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * `/documents` — pièces comptables (factures, contrats, justificatifs).
 *
 * Surface MVP : upload multipart, liste filtrable, download via
 * fetch authenticated puis blob link (le endpoint /content sert le
 * fichier original avec Content-Disposition), soft-delete.
 */
export default function DocumentsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();

  const [filterTag, setFilterTag] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const docsQuery = useQuery<ListResponse, ApiError>({
    queryKey: ['documents', orgId, filterTag, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterTag.trim() !== '') params.set('tag', filterTag.trim());
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      return api.get<ListResponse>(`/documents?${params.toString()}`);
    },
    enabled: orgId !== '',
  });

  // ─── Upload ─────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const upload = useApiMutation(
    async () => {
      if (!file) {
        throw new ApiError(422, { code: 'DOC_FILE_REQUIRED', message: 'Sélectionner un fichier.' });
      }
      const fd = new FormData();
      fd.append('file', file);
      if (description.trim() !== '') fd.append('description', description.trim());
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '');
      for (const tag of tags) fd.append('tags[]', tag);
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/documents`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const text = await res.text();
      const env = text === '' ? {} : (JSON.parse(text) as { data?: unknown; error?: { code: string; message: string } });
      if (!res.ok || env.error) {
        throw new ApiError(res.status, {
          code: env.error?.code ?? 'NETWORK_ERROR',
          message: env.error?.message ?? `HTTP ${res.status}`,
        });
      }
      return env.data;
    },
    {
      onSuccess: () => {
        setFile(null);
        setDescription('');
        setTagsInput('');
        void qc.invalidateQueries({ queryKey: ['documents', orgId] });
      },
    },
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pièces comptables : factures, contrats, justificatifs. Stockage hash-addressé
            avec dédoublonnage SHA-256 ; OCR (Module 10 vague 2) extraira les champs
            automatiquement.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Téléverser un document</CardTitle>
            <CardDescription>
              Tags séparés par virgules (ex. <code>facture, fournisseur, mars-2026</code>).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                upload.mutate(undefined);
              }}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="file">Fichier</Label>
                  <Input
                    id="file"
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="cursor-pointer file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1 file:text-sm"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="doc-tags">Tags</Label>
                  <Input
                    id="doc-tags"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="facture, fournisseur"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="doc-desc">Description</Label>
                <Input
                  id="doc-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex. Facture EDF mars 2026"
                  maxLength={2000}
                />
              </div>
              <Button type="submit" disabled={!file || upload.isPending}>
                {upload.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Téléverser
              </Button>
              <FormError error={upload.error} />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bibliothèque</CardTitle>
            <CardDescription>
              {docsQuery.data?.total ?? 0} document(s) — page {page}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex gap-2">
              <Input
                value={filterTag}
                onChange={(e) => {
                  setFilterTag(e.target.value);
                  setPage(1);
                }}
                placeholder="Filtrer par tag…"
                className="max-w-xs"
              />
            </div>

            {docsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (docsQuery.data?.rows.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun document.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Fichier</th>
                      <th className="px-3 py-2 text-left">Tags</th>
                      <th className="px-3 py-2 text-right">Taille</th>
                      <th className="px-3 py-2 text-left">OCR</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(docsQuery.data?.rows ?? []).map((d) => (
                      <DocumentRow key={d.id} doc={d} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <FormError error={docsQuery.error} className="mt-3" />

            <div className="mt-3 flex items-center justify-between text-sm">
              <Button
                type="button"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Précédent
              </Button>
              <span className="text-muted-foreground">Page {page}</span>
              <Button
                type="button"
                variant="outline"
                disabled={(docsQuery.data?.rows.length ?? 0) < pageSize}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function DocumentRow({ doc }: { doc: DocumentView }) {
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState(false);

  const downloadFile = async () => {
    setDownloading(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/documents/${doc.id}/content`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const remove = useApiMutation(async () => api.delete(`/documents/${doc.id}`), {
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });

  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Paperclip className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{doc.filename}</span>
        </div>
        {doc.description && (
          <div className="text-xs text-muted-foreground">{doc.description}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {doc.tags.map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {(doc.sizeBytes / 1024).toFixed(1)} KB
      </td>
      <td className="px-3 py-2">
        <Badge variant={doc.ocrStatus === 'completed' ? 'default' : 'muted'}>
          {doc.ocrStatus}
        </Badge>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {new Date(doc.uploadedAt).toLocaleDateString('fr-FR')}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <Button type="button" size="sm" variant="outline" disabled={downloading} onClick={downloadFile}>
            {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined)}
          >
            {remove.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
          </Button>
        </div>
      </td>
    </tr>
  );
}
