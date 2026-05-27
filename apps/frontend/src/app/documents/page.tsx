'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
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

const OCR_TONE: Record<OcrStatus, string> = {
  pending: 'bg-sunk/60 text-ink-soft',
  processing: 'bg-info/15 text-info-ink',
  completed: 'bg-accent/15 text-accent-ink',
  failed: 'bg-critical/15 text-critical-ink',
  skipped: 'bg-sunk/60 text-ink-mute',
};

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
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Pièces justificatives</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">Documents</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Pièces comptables : factures, contrats, justificatifs. Stockage hash-addressé
            avec dédoublonnage SHA-256 ; OCR (Module 10 vague 2) extraira les champs
            automatiquement.
          </p>
        </header>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Téléverser un document</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Tags séparés par virgules (ex. <code className="rounded-sm bg-sunk px-1 py-0.5 text-xs text-ink-soft">facture, fournisseur, mars-2026</code>).
            </p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-5">
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
                    className="cursor-pointer file:mr-3 file:rounded-sm file:border file:border-line-strong file:bg-paper file:px-3 file:py-1 file:text-sm"
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
              <Button type="submit" disabled={!file || upload.isPending} className="press">
                {upload.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Téléverser
              </Button>
              <FormError error={upload.error} />
            </form>
          </div>
        </section>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Bibliothèque</h2>
            <p className="mt-1 text-sm text-ink-mute">
              {docsQuery.data?.total ?? 0} document(s) — page {page}
            </p>
          </div>

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
            <p className="text-sm text-ink-mute">Chargement…</p>
          ) : (docsQuery.data?.rows.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-mute">Aucun document.</p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead className="bg-sunk">
                  <tr>
                    <th className="px-3 py-2 text-left"><span className="eyebrow">Fichier</span></th>
                    <th className="px-3 py-2 text-left"><span className="eyebrow">Tags</span></th>
                    <th className="px-3 py-2 text-right"><span className="eyebrow">Taille</span></th>
                    <th className="px-3 py-2 text-left"><span className="eyebrow">OCR</span></th>
                    <th className="px-3 py-2 text-left"><span className="eyebrow">Date</span></th>
                    <th className="px-3 py-2 text-right"><span className="eyebrow">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(docsQuery.data?.rows ?? []).map((d, idx) => (
                    <DocumentRow key={d.id} doc={d} alt={idx % 2 === 1} />
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
              className="press"
            >
              Précédent
            </Button>
            <span className="text-ink-mute">Page {page}</span>
            <Button
              type="button"
              variant="outline"
              disabled={(docsQuery.data?.rows.length ?? 0) < pageSize}
              onClick={() => setPage((p) => p + 1)}
              className="press"
            >
              Suivant
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function DocumentRow({ doc, alt }: { doc: DocumentView; alt: boolean }) {
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
    <tr className={`border-t border-line transition-colors hover:bg-sunk/50 ${alt ? 'bg-sunk/20' : ''}`}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Paperclip className="h-3 w-3 text-ink-mute" />
          <span className="font-medium text-ink">{doc.filename}</span>
        </div>
        {doc.description && (
          <div className="text-xs text-ink-mute">{doc.description}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {doc.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-sm border border-line bg-paper px-1.5 py-0.5 text-[11px] font-medium text-ink-soft"
            >
              {t}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-ink">
        {(doc.sizeBytes / 1024).toFixed(1)} KB
      </td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium ${OCR_TONE[doc.ocrStatus]}`}>
          {doc.ocrStatus}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-ink-mute">
        {new Date(doc.uploadedAt).toLocaleDateString('fr-FR')}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <Button type="button" size="sm" variant="outline" disabled={downloading} onClick={downloadFile} className="press">
            {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined)}
            className="press"
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
