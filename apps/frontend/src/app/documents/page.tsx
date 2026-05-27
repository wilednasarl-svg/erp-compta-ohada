'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

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
  pending: 'bg-sunk text-ink-soft',
  processing: 'bg-info-soft text-info-ink',
  completed: 'bg-accent-soft text-accent-ink',
  failed: 'bg-critical-soft text-critical-ink',
  skipped: 'bg-sunk text-ink-mute',
};

const OCR_LABEL: Record<OcrStatus, string> = {
  pending: 'En attente',
  processing: 'OCR en cours',
  completed: 'OCR terminé',
  failed: 'OCR échoué',
  skipped: 'OCR ignoré',
};

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx + 1).toUpperCase();
}

function FileTypeBadge({ filename }: { filename: string }) {
  const ext = fileExtension(filename);
  const tone =
    ext === 'PDF'
      ? 'bg-critical-soft text-critical-ink'
      : ext === 'CSV'
        ? 'bg-info-soft text-info-ink'
        : ext === 'XLSX' || ext === 'XLS'
          ? 'bg-accent-soft text-accent-ink'
          : 'bg-sunk text-ink-soft';
  return (
    <span className={`inline-flex items-center rounded-xs px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${tone}`}>
      {ext || 'FILE'}
    </span>
  );
}

function FileIcon({ filename }: { filename: string }) {
  const ext = fileExtension(filename);
  if (ext === 'CSV' || ext === 'XLSX' || ext === 'XLS') {
    return <FileSpreadsheet className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />;
  }
  if (ext === 'PDF') {
    return <FileText className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />;
  }
  return <Paperclip className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-8 w-8 rounded-full bg-sunk" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded-xs bg-sunk" />
            <div className="h-2.5 w-48 rounded-xs bg-sunk" />
          </div>
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
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
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
    </div>
  );
}

function DocumentPreviewModal({
  filename,
  mimeType,
  url,
  onClose,
}: {
  filename: string;
  mimeType: string;
  url: string;
  onClose: () => void;
}) {
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  const isText = mimeType.startsWith('text/');
  const [textContent, setTextContent] = useState<string | null>(null);

  useEffect(() => {
    if (isText) {
      fetch(url)
        .then((r) => r.text())
        .then(setTextContent)
        .catch(() => setTextContent('Erreur de lecture du fichier.'));
    }
  }, [url, isText]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const canPreview = isImage || isPdf || isText;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-sm border border-line bg-paper shadow-2xl"
        style={{ animation: 'var(--animate-page-in)' }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-paper px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileTypeBadge filename={filename} />
            <span className="truncate text-sm font-medium text-ink">{filename}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={url}
              download={filename}
              className="press inline-flex h-7 items-center gap-1.5 rounded-xs border border-line px-2 text-xs text-ink-soft transition-colors duration-fast hover:border-accent hover:text-accent-ink"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
              Télécharger
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer l'aperçu"
              className="press inline-flex h-7 w-7 items-center justify-center rounded-xs border border-line text-ink-mute transition-colors duration-fast hover:border-line-strong hover:text-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-canvas">
          {isImage && (
            <div className="flex min-h-64 items-center justify-center p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={filename}
                className="max-h-[78vh] max-w-full rounded-xs object-contain shadow-sm"
              />
            </div>
          )}

          {isPdf && (
            <iframe
              src={url}
              title={filename}
              className="h-[78vh] w-full border-0"
            />
          )}

          {isText && textContent === null && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-ink-mute" />
            </div>
          )}

          {isText && textContent !== null && (
            <pre className="max-h-[78vh] overflow-auto p-5 font-mono text-xs leading-relaxed text-ink-soft">
              {textContent}
            </pre>
          )}

          {!canPreview && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
                <FileIcon filename={filename} />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">Aperçu non disponible</p>
                <p className="mt-1 text-xs text-ink-mute">
                  Ce type de fichier ne peut pas être affiché directement.
                </p>
              </div>
              <a
                href={url}
                download={filename}
                className="inline-flex items-center gap-1.5 rounded-sm bg-sunk px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                Télécharger le fichier
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

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

  const rows = docsQuery.data?.rows ?? [];

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Organisation · GED</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">Documents</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Gestion électronique des pièces justificatives. Associez chaque document à une écriture
            ou une période.
          </p>
        </header>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Téléverser un document</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Tags séparés par virgules (ex.{' '}
              <code className="rounded-xs bg-sunk px-1 py-0.5 font-mono text-xs text-ink-soft">
                facture, fournisseur, mars-2026
              </code>
              ).
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
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
            <div>
              <h2 className="font-display text-xl font-medium text-ink">Bibliothèque</h2>
              <p className="mt-1 text-sm text-ink-mute">
                <span className="font-mono tabular-nums text-ink">{docsQuery.data?.total ?? 0}</span> document
                {(docsQuery.data?.total ?? 0) > 1 ? 's' : ''} · page{' '}
                <span className="font-mono tabular-nums">{page}</span>
              </p>
            </div>
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

          <div className="rounded-sm border border-line bg-paper">
            {docsQuery.isLoading ? (
              <SkeletonRows n={5} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Paperclip}
                title="Aucun document"
                description="Importez des pièces justificatives pour les associer à vos écritures."
              />
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((d) => (
                  <DocumentRow key={d.id} doc={d} />
                ))}
              </ul>
            )}
          </div>
          <FormError error={docsQuery.error} className="mt-3" />

          {rows.length > 0 && (
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
              <span className="font-mono tabular-nums text-xs text-ink-mute">Page {page}</span>
              <Button
                type="button"
                variant="outline"
                disabled={rows.length < pageSize}
                onClick={() => setPage((p) => p + 1)}
                className="press"
              >
                Suivant
              </Button>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function DocumentRow({ doc }: { doc: DocumentView }) {
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const openPreview = async () => {
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/documents/${doc.id}/content`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const blob = await res.blob();
      const mime = blob.type || doc.mimeType;
      const url = URL.createObjectURL(blob);
      setPreview({ url, mime });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Impossible de charger le document');
    } finally {
      setLoadingPreview(false);
    }
  };

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

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
    <>
      <li className="group flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-sunk/30">
        <button
          type="button"
          onClick={openPreview}
          disabled={loadingPreview}
          aria-label={`Aperçu de ${doc.filename}`}
          className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-sm bg-sunk transition-colors duration-fast hover:bg-canvas disabled:cursor-wait"
          title="Cliquer pour visualiser"
        >
          {loadingPreview ? (
            <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />
          ) : (
            <FileIcon filename={doc.filename} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={openPreview}
            disabled={loadingPreview}
            className="group/name flex cursor-pointer items-center gap-2 text-left"
          >
            <FileTypeBadge filename={doc.filename} />
            <span className="truncate text-sm font-medium text-ink underline-offset-2 group-hover/name:underline">
              {doc.filename}
            </span>
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mute">
            <span className="font-mono tabular-nums">{formatSize(doc.sizeBytes)}</span>
            <span aria-hidden>·</span>
            <span title={new Date(doc.uploadedAt).toLocaleString('fr-FR')}>
              {new Date(doc.uploadedAt).toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
            {doc.description && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate text-ink-soft">{doc.description}</span>
              </>
            )}
          </div>
          {doc.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {doc.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center rounded-xs border border-line bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-soft"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <span
          className={`hidden shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium md:inline-flex ${OCR_TONE[doc.ocrStatus]}`}
        >
          {OCR_LABEL[doc.ocrStatus]}
        </span>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            disabled={loadingPreview}
            onClick={openPreview}
            aria-label={`Visualiser ${doc.filename}`}
            className="press inline-flex h-7 w-7 items-center justify-center rounded-xs border border-line text-ink-soft transition-colors duration-fast hover:border-info hover:text-info-ink disabled:opacity-40"
            title="Visualiser"
          >
            {loadingPreview ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={downloadFile}
            aria-label={`Télécharger ${doc.filename}`}
            className="press inline-flex h-7 w-7 items-center justify-center rounded-xs border border-line text-ink-soft transition-colors duration-fast hover:border-accent hover:text-accent-ink disabled:opacity-40"
            title="Télécharger"
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined)}
            aria-label={`Supprimer ${doc.filename}`}
            className="press inline-flex h-7 w-7 items-center justify-center rounded-xs border border-line text-ink-mute transition-colors duration-fast hover:border-critical hover:text-critical-ink disabled:opacity-40"
            title="Supprimer"
          >
            {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
          </button>
        </div>
      </li>

      {previewError && (
        <li className="flex items-center gap-2 border-t border-critical-soft bg-critical-soft px-4 py-2 text-xs text-critical-ink">
          <span className="font-medium">Aperçu indisponible :</span>
          <span>{previewError}</span>
          <button
            type="button"
            onClick={() => setPreviewError(null)}
            className="ml-auto shrink-0 text-critical-ink/60 hover:text-critical-ink"
            aria-label="Fermer l'erreur"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </li>
      )}

      {preview && (
        <DocumentPreviewModal
          filename={doc.filename}
          mimeType={preview.mime}
          url={preview.url}
          onClose={closePreview}
        />
      )}
    </>
  );
}
