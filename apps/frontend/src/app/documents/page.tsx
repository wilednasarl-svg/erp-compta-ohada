'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckSquare,
  Download,
  Eye,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Link2,
  Loader2,
  Paperclip,
  RefreshCw,
  ScanText,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { useDebounce } from '@/hooks/use-debounce';
import { ApiError, api, getAuthToken } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

import { DocumentStats } from './_components/document-stats';
import {
  DocumentFilters,
  type DocumentCategory,
  type OcrStatusFilter,
} from './_components/document-filters';
import { DropzoneUploader } from './_components/dropzone-uploader';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/** Mirrors the backend default `DOC_MAX_FILE_SIZE_MB` (25 Mo). */
const MAX_FILE_SIZE_MB = 25;
/** MIME/extension allow-list aligned with the backend upload validation. */
const ACCEPT_ATTR =
  'image/*,application/pdf,.csv,.txt,.xls,.xlsx,.doc,.docx,.ods,.odt';

type OcrStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'skipped';

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
  /** Nombre d'écritures auxquelles ce justificatif est rattaché (liste). */
  readonly linkedEntryCount?: number;
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
  processed: 'bg-accent-soft text-accent-ink',
  failed: 'bg-critical-soft text-critical-ink',
  skipped: 'bg-sunk text-ink-mute',
};

const OCR_LABEL: Record<OcrStatus, string> = {
  pending: 'En attente',
  processing: 'OCR en cours',
  processed: 'OCR terminé',
  failed: 'OCR échoué',
  skipped: 'OCR ignoré',
};

interface OcrInvoiceParty {
  readonly name?: string;
  readonly ncc?: string;
  readonly taxRegime?: string;
}
interface OcrProposedLine {
  readonly accountCode: string;
  readonly debit: number;
  readonly credit: number;
  readonly description?: string | null;
}
interface OcrProposedEntry {
  readonly journalCode: string;
  readonly entryDate: string | null;
  readonly description: string;
  readonly reference: string | null;
  readonly lines: ReadonlyArray<OcrProposedLine>;
  readonly balanced: boolean;
  readonly warnings: ReadonlyArray<string>;
}
interface OcrInvoice {
  readonly supplier?: OcrInvoiceParty;
  readonly customer?: OcrInvoiceParty;
  readonly invoiceNumber?: string;
  readonly erpInvoiceNumber?: string;
  readonly invoiceDate?: string;
  readonly paymentMode?: string;
  readonly totals?: {
    readonly totalHt?: number;
    readonly totalVat?: number;
    readonly totalTtc?: number;
    readonly totalToPay?: number;
  };
  readonly lines?: ReadonlyArray<{
    readonly designation?: string;
    readonly quantity?: number;
    readonly unitPriceHt?: number;
    readonly amountHt?: number;
  }>;
}
interface OcrDiagnostics {
  readonly engine: string;
  readonly checks: ReadonlyArray<{
    readonly name: string;
    readonly ok: boolean;
    readonly detail?: string;
  }>;
}
interface OcrResult {
  readonly ocrStatus: OcrStatus;
  readonly ocrText: string | null;
  readonly extractedMetadata:
    | {
        readonly invoice?: OcrInvoice;
        readonly proposedEntry?: OcrProposedEntry;
        /** Présent quand l'OCR a été ignoré : diagnostic du moteur. */
        readonly ocrSkip?: OcrDiagnostics;
      }
    | null;
}

function formatAmount(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR');
}

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
  const debouncedTag = useDebounce(filterTag.trim(), 350);
  const [category, setCategory] = useState<DocumentCategory>('all');
  const [ocrStatus, setOcrStatus] = useState<OcrStatusFilter>('all');
  const [uploadedFrom, setUploadedFrom] = useState('');
  const [uploadedTo, setUploadedTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Selected document ids for bulk actions (cleared when the result set changes).
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const advancedFilterCount =
    (category !== 'all' ? 1 : 0) +
    (ocrStatus !== 'all' ? 1 : 0) +
    (uploadedFrom !== '' ? 1 : 0) +
    (uploadedTo !== '' ? 1 : 0);

  /** Any filter change must return to page 1 and drop the current selection. */
  const onFilterChange = () => {
    setPage(1);
    setSelectedIds(new Set());
  };

  const resetAdvancedFilters = () => {
    setCategory('all');
    setOcrStatus('all');
    setUploadedFrom('');
    setUploadedTo('');
    onFilterChange();
  };

  const docsQuery = useQuery<ListResponse, ApiError>({
    queryKey: ['documents', orgId, debouncedTag, category, ocrStatus, uploadedFrom, uploadedTo, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedTag !== '') params.set('tag', debouncedTag);
      if (category !== 'all') params.set('category', category);
      if (ocrStatus !== 'all') params.set('ocrStatus', ocrStatus);
      // <input type="date"> yields 'YYYY-MM-DD'; widen to full-day bounds so the
      // server-side `uploaded_at` BETWEEN comparison covers the whole day.
      if (uploadedFrom !== '') params.set('uploadedFrom', `${uploadedFrom}T00:00:00.000Z`);
      if (uploadedTo !== '') params.set('uploadedTo', `${uploadedTo}T23:59:59.999Z`);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      return api.get<ListResponse>(`/documents?${params.toString()}`);
    },
    enabled: orgId !== '',
  });

  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  // Bumped on success to force the uncontrolled <input type="file"> to reset.
  const [fileInputKey, setFileInputKey] = useState(0);

  const selectTag = (tag: string) => {
    setFilterTag(tag);
    onFilterChange();
  };

  const upload = useApiMutation(
    async () => {
      if (!file) {
        throw new ApiError(422, { code: 'DOC_FILE_REQUIRED', message: 'Sélectionner un fichier.' });
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        throw new ApiError(422, {
          code: 'DOC_FILE_TOO_LARGE',
          message: `Fichier trop volumineux (${formatSize(file.size)}). Taille max : ${MAX_FILE_SIZE_MB} Mo.`,
        });
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
        setFileInputKey((k) => k + 1);
        toast.success('Document téléversé avec succès.');
        // Préfixe partagé : invalide la liste ET le bandeau de stats
        // (clés ['documents', 'stats', …]) pour des compteurs exacts.
        void qc.invalidateQueries({ queryKey: ['documents'] });
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const bulkDelete = useApiMutation(
    async () => {
      const ids = [...selectedIds];
      const results = await Promise.allSettled(
        ids.map((id) => api.delete(`/documents/${id}`)),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { count: ids.length, failed };
    },
    {
      onSuccess: ({ count, failed }) => {
        setBulkConfirm(false);
        setSelectedIds(new Set());
        if (failed === 0) {
          toast.success(`${count} document${count > 1 ? 's' : ''} supprimé${count > 1 ? 's' : ''}.`);
        } else {
          toast.error(`${failed} suppression${failed > 1 ? 's' : ''} sur ${count} en échec.`);
        }
        void qc.invalidateQueries({ queryKey: ['documents'] });
      },
      onError: (err) => {
        setBulkConfirm(false);
        toast.error(err.message);
      },
    },
  );

  const rows = docsQuery.data?.rows ?? [];
  const total = docsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  // Justificatifs sélectionnés qui sont rattachés à au moins une écriture —
  // la sélection est bornée à la page visible (purgée au changement de page),
  // donc ce compte est exact pour la suppression en lot.
  const linkedSelectedCount = rows.filter(
    (r) => selectedIds.has(r.id) && (r.linkedEntryCount ?? 0) > 0,
  ).length;

  /** Change de page et purge la sélection (bornée à la page visible). */
  const changePage = (next: number) => {
    setPage(Math.min(totalPages, Math.max(1, next)));
    setSelectedIds(new Set());
    setBulkConfirm(false);
  };

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (rows.length > 0 && rows.every((r) => prev.has(r.id))) {
        for (const r of rows) next.delete(r.id);
      } else {
        for (const r of rows) next.add(r.id);
      }
      return next;
    });
  };

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Organisation · GED</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">Documents</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Gestion électronique des pièces justificatives : importez vos factures, relevés et autres
            justificatifs, organisez-les par tags et retrouvez-les en un clic.
          </p>
        </header>

        <DocumentStats orgId={orgId} />

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Téléverser un document</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Formats : PDF, images, Excel/Word, CSV. Taille max : {MAX_FILE_SIZE_MB} Mo. Tags séparés
              par virgules (ex.{' '}
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
              <div className="space-y-1">
                <Label htmlFor="file">Fichier</Label>
                <DropzoneUploader
                  key={fileInputKey}
                  file={file}
                  onFileChange={setFile}
                  accept={ACCEPT_ATTR}
                  maxSizeMb={MAX_FILE_SIZE_MB}
                  disabled={upload.isPending}
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
                <span className="font-mono tabular-nums text-ink">{total}</span> document
                {total > 1 ? 's' : ''} · page{' '}
                <span className="font-mono tabular-nums">{page}</span> / {totalPages}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-tag" className="text-ink-mute">
                Filtrer par tag (ex. fournisseur, période)
              </Label>
              <div className="relative">
                <Input
                  id="filter-tag"
                  value={filterTag}
                  onChange={(e) => {
                    setFilterTag(e.target.value);
                    onFilterChange();
                  }}
                  placeholder="Filtrer par tag…"
                  className="max-w-xs pr-8"
                />
                {filterTag !== '' && (
                  <button
                    type="button"
                    onClick={() => selectTag('')}
                    aria-label="Effacer le filtre"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-mute transition-colors hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <DocumentFilters
            category={category}
            onCategoryChange={(c) => {
              setCategory(c);
              onFilterChange();
            }}
            ocrStatus={ocrStatus}
            onOcrStatusChange={(s) => {
              setOcrStatus(s);
              onFilterChange();
            }}
            uploadedFrom={uploadedFrom}
            onUploadedFromChange={(v) => {
              setUploadedFrom(v);
              onFilterChange();
            }}
            uploadedTo={uploadedTo}
            onUploadedToChange={(v) => {
              setUploadedTo(v);
              onFilterChange();
            }}
            onReset={resetAdvancedFilters}
            activeCount={advancedFilterCount}
          />

          {/* Bulk-action toolbar: select-all on page + actions on the current selection. */}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-sm border border-line bg-canvas px-4 py-2">
              <button
                type="button"
                onClick={toggleSelectAllOnPage}
                aria-pressed={allOnPageSelected}
                className="press inline-flex items-center gap-2 text-xs text-ink-soft transition-colors duration-fast hover:text-ink"
              >
                {allOnPageSelected ? (
                  <CheckSquare className="h-4 w-4 text-accent-ink" strokeWidth={1.5} />
                ) : (
                  <Square className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
                )}
                Tout sélectionner (page)
              </button>

              {selectedIds.size > 0 && (
                <>
                  <span className="text-xs text-ink-mute" aria-live="polite">
                    <span className="font-mono tabular-nums text-ink">{selectedIds.size}</span>{' '}
                    sélectionné{selectedIds.size > 1 ? 's' : ''}
                  </span>
                  {bulkConfirm && linkedSelectedCount > 0 && (
                    <span
                      className="flex basis-full items-center gap-1.5 text-[11px] text-critical-ink"
                      role="alert"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span>
                        <span className="font-mono tabular-nums">{linkedSelectedCount}</span>{' '}
                        justificatif{linkedSelectedCount > 1 ? 's' : ''} rattaché
                        {linkedSelectedCount > 1 ? 's' : ''} à des écritures —{' '}
                        l&apos;écriture n&apos;est pas supprimée, mais perdra sa pièce jointe.
                      </span>
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    {bulkConfirm ? (
                      <>
                        <button
                          type="button"
                          disabled={bulkDelete.isPending}
                          onClick={() => bulkDelete.mutate(undefined)}
                          className="press inline-flex h-7 items-center gap-1 rounded-xs bg-critical px-2 text-[11px] font-medium text-paper transition-colors duration-fast hover:bg-critical-ink disabled:opacity-40"
                        >
                          {bulkDelete.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} />
                          )}
                          Supprimer {selectedIds.size}
                        </button>
                        <button
                          type="button"
                          disabled={bulkDelete.isPending}
                          onClick={() => setBulkConfirm(false)}
                          className="press inline-flex h-7 items-center rounded-xs border border-line px-2 text-[11px] text-ink-soft transition-colors duration-fast hover:border-line-strong hover:text-ink disabled:opacity-40"
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setBulkConfirm(true)}
                        className="press inline-flex h-7 items-center gap-1.5 rounded-xs border border-line px-2 text-[11px] text-ink-soft transition-colors duration-fast hover:border-critical hover:text-critical-ink"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Supprimer la sélection
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="rounded-sm border border-line bg-paper">
            {docsQuery.isLoading ? (
              <SkeletonRows n={5} />
            ) : rows.length === 0 ? (
              debouncedTag !== '' || advancedFilterCount > 0 ? (
                <EmptyState
                  icon={Paperclip}
                  title="Aucun document ne correspond aux filtres"
                  description="Aucune pièce ne correspond aux critères actuels. Élargissez ou réinitialisez les filtres pour voir davantage de documents."
                />
              ) : (
                <EmptyState
                  icon={Paperclip}
                  title="Aucun document"
                  description="Importez vos premières pièces justificatives pour les retrouver ici."
                />
              )
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((d) => (
                  <DocumentRow
                    key={d.id}
                    doc={d}
                    activeTag={debouncedTag}
                    onTagClick={selectTag}
                    selected={selectedIds.has(d.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </ul>
            )}
          </div>
          <FormError error={docsQuery.error} className="mt-3" />

          {total > pageSize && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => changePage(page - 1)}
                className="press"
              >
                Précédent
              </Button>
              <span className="font-mono tabular-nums text-xs text-ink-mute">
                Page {page} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => changePage(page + 1)}
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

function DocumentRow({
  doc,
  activeTag,
  onTagClick,
  selected,
  onToggleSelect,
}: {
  doc: DocumentView;
  activeTag: string;
  onTagClick: (tag: string) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showOcr, setShowOcr] = useState(false);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [chargeAccount, setChargeAccount] = useState('');
  // Aperçu du document chargé en ligne (à côté des données OCR).
  const [ocrDoc, setOcrDoc] = useState<{ url: string; mime: string } | null>(null);

  /** Télécharge le contenu binaire du document et renvoie une URL blob + son type MIME. */
  const fetchContent = async (): Promise<{ url: string; mime: string }> => {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/documents/${doc.id}/content`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), mime: blob.type || doc.mimeType };
  };

  const toggleOcr = async () => {
    if (showOcr) {
      setShowOcr(false);
      return;
    }
    setShowOcr(true);
    if (ocr !== null) return; // already loaded
    setOcrLoading(true);
    setOcrError(null);
    try {
      const data = await api.get<OcrResult>(`/documents/${doc.id}/ocr`);
      setOcr(data);
      const proposed = data.extractedMetadata?.proposedEntry;
      const firstCharge = proposed?.lines.find((l) => l.debit > 0)?.accountCode;
      if (firstCharge && chargeAccount === '') setChargeAccount(firstCharge);
      // Charge l'aperçu de la pièce pour l'afficher à côté de l'extraction.
      if (ocrDoc === null) {
        try {
          setOcrDoc(await fetchContent());
        } catch {
          // L'aperçu reste optionnel : l'extraction s'affiche même si le binaire est introuvable.
        }
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Impossible de charger les données OCR.');
    } finally {
      setOcrLoading(false);
    }
  };

  // Libère l'URL blob de l'aperçu en ligne au démontage.
  useEffect(() => {
    return () => {
      if (ocrDoc) URL.revokeObjectURL(ocrDoc.url);
    };
  }, [ocrDoc]);

  const createEntry = useApiMutation(
    async () =>
      api.post<{ entry?: { entryNumber?: number; journalCode?: string } }>(
        `/documents/${doc.id}/create-entry`,
        chargeAccount.trim() !== '' ? { chargeAccount: chargeAccount.trim() } : {},
      ),
    {
      onSuccess: (res) => {
        const num = res?.entry?.entryNumber;
        toast.success(num ? `Écriture brouillon créée (n° ${num}).` : 'Écriture brouillon créée.');
        void qc.invalidateQueries({ queryKey: ['documents'] });
      },
      onError: (err) => toast.error(err.message),
    },
  );

  // Relance l'OCR sur une pièce « ignorée » ou en échec (PDF dont la
  // rasterisation a échoué à l'upload, ou timeout transitoire du moteur).
  const retryOcr = useApiMutation(
    async () => api.post<{ ocrStatus: OcrStatus }>(`/documents/${doc.id}/retry-ocr`, {}),
    {
      onSuccess: () => {
        toast.success('OCR relancé — le traitement peut prendre jusqu’à 2 min.');
        void qc.invalidateQueries({ queryKey: ['documents'] });
        // Le moteur (PaddleOCR-VL via ZeroGPU) termine en arrière-plan ; on
        // resynchronise la liste à intervalles pour refléter le statut final
        // sans action de l'utilisateur.
        [5, 15, 30, 60, 120].forEach((s) =>
          setTimeout(() => void qc.invalidateQueries({ queryKey: ['documents'] }), s * 1000),
        );
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const openPreview = async () => {
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      setPreview(await fetchContent());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Impossible de charger le document';
      const friendly = msg.includes('404')
        ? 'Fichier introuvable sur le serveur (Erreur 404). Le fichier a peut-être été perdu lors d\'un redémarrage du serveur.'
        : msg.includes('401') || msg.includes('403')
          ? 'Accès refusé — vérifiez votre session (Erreur ' + msg.replace(/\D/g, '') + ').'
          : msg;
      setPreviewError(friendly);
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
    } catch (err) {
      toast.error(
        err instanceof Error ? `Téléchargement impossible : ${err.message}` : 'Téléchargement impossible.',
      );
    } finally {
      setDownloading(false);
    }
  };

  const remove = useApiMutation(async () => api.delete(`/documents/${doc.id}`), {
    onSuccess: () => {
      setConfirmDelete(false);
      toast.success('Document supprimé.');
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => {
      setConfirmDelete(false);
      toast.error(err.message);
    },
  });

  return (
    <>
      <li
        className={`group flex items-center gap-3 px-4 py-3 transition-colors duration-fast ${
          selected ? 'bg-accent-soft/40' : 'hover:bg-sunk/30'
        }`}
      >
        <button
          type="button"
          onClick={() => onToggleSelect(doc.id)}
          aria-pressed={selected}
          aria-label={selected ? `Désélectionner ${doc.filename}` : `Sélectionner ${doc.filename}`}
          className="press inline-flex h-5 w-5 shrink-0 items-center justify-center text-ink-mute transition-colors duration-fast hover:text-ink"
        >
          {selected ? (
            <CheckSquare className="h-4 w-4 text-accent-ink" strokeWidth={1.5} />
          ) : (
            <Square className="h-4 w-4" strokeWidth={1.5} />
          )}
        </button>
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
              {doc.tags.map((t) => {
                const isActive = activeTag !== '' && t.toLowerCase() === activeTag.toLowerCase();
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onTagClick(isActive ? '' : t)}
                    aria-pressed={isActive}
                    title={isActive ? 'Retirer le filtre' : `Filtrer par « ${t} »`}
                    className={`press inline-flex items-center rounded-xs border px-1.5 py-0.5 text-[10px] font-medium transition-colors duration-fast ${
                      isActive
                        ? 'border-accent bg-accent-soft text-accent-ink'
                        : 'border-line bg-canvas text-ink-soft hover:border-accent hover:text-accent-ink'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {doc.linkedEntryCount !== undefined && doc.linkedEntryCount > 0 && (
          <span
            className="hidden shrink-0 items-center gap-1 rounded-xs border border-line px-1.5 py-0.5 text-[11px] font-medium text-ink-mute sm:inline-flex"
            title={`Rattaché à ${doc.linkedEntryCount} écriture${doc.linkedEntryCount > 1 ? 's' : ''} — la suppression détache la pièce sans supprimer l'écriture`}
          >
            <Link2 className="h-3 w-3" strokeWidth={1.5} />
            <span className="font-mono tabular-nums">{doc.linkedEntryCount}</span>
          </span>
        )}
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
          {(doc.ocrStatus === 'processed' ||
            doc.ocrStatus === 'skipped' ||
            doc.ocrStatus === 'failed') && (
            <button
              type="button"
              onClick={toggleOcr}
              aria-expanded={showOcr}
              aria-label={
                doc.ocrStatus === 'processed'
                  ? `Données OCR et écriture pour ${doc.filename}`
                  : `Diagnostic OCR pour ${doc.filename}`
              }
              className={`press inline-flex h-7 w-7 items-center justify-center rounded-xs border transition-colors duration-fast ${
                showOcr
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-line text-ink-soft hover:border-accent hover:text-accent-ink'
              }`}
              title={
                doc.ocrStatus === 'processed'
                  ? "OCR & proposition d'écriture"
                  : 'Pourquoi l’OCR a été ignoré'
              }
            >
              {ocrLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ScanText className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
            </button>
          )}
          {(doc.ocrStatus === 'skipped' ||
            doc.ocrStatus === 'failed' ||
            doc.ocrStatus === 'processing') && (
            <button
              type="button"
              disabled={retryOcr.isPending || doc.ocrStatus === 'processing'}
              onClick={() => retryOcr.mutate(undefined)}
              aria-label={`Relancer l'OCR pour ${doc.filename}`}
              className="press inline-flex h-7 w-7 items-center justify-center rounded-xs border border-line text-ink-soft transition-colors duration-fast hover:border-accent hover:text-accent-ink disabled:opacity-40"
              title={doc.ocrStatus === 'processing' ? 'OCR en cours…' : "Relancer l'OCR"}
            >
              {retryOcr.isPending || doc.ocrStatus === 'processing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
            </button>
          )}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate(undefined)}
                aria-label={`Confirmer la suppression de ${doc.filename}`}
                className="press inline-flex h-7 items-center gap-1 rounded-xs bg-critical px-2 text-[11px] font-medium text-paper transition-colors duration-fast hover:bg-critical-ink disabled:opacity-40"
                title="Confirmer la suppression"
              >
                {remove.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
                Confirmer
              </button>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => setConfirmDelete(false)}
                aria-label="Annuler la suppression"
                className="press inline-flex h-7 items-center rounded-xs border border-line px-2 text-[11px] text-ink-soft transition-colors duration-fast hover:border-line-strong hover:text-ink disabled:opacity-40"
                title="Annuler"
              >
                Annuler
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Supprimer ${doc.filename}`}
              className="press inline-flex h-7 w-7 items-center justify-center rounded-xs border border-line text-ink-mute transition-colors duration-fast hover:border-critical hover:text-critical-ink"
              title="Supprimer"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </li>

      {showOcr && (
        <li className="border-t border-line bg-canvas px-4 py-4">
          {ocrLoading ? (
            <div className="flex items-center gap-2 text-xs text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement des données OCR…
            </div>
          ) : ocrError ? (
            <p className="text-xs text-critical-ink">{ocrError}</p>
          ) : ocr ? (
            <OcrPanel
              ocr={ocr}
              filename={doc.filename}
              docPreview={ocrDoc}
              chargeAccount={chargeAccount}
              setChargeAccount={setChargeAccount}
              onCreate={() => createEntry.mutate(undefined)}
              creating={createEntry.isPending}
            />
          ) : null}
        </li>
      )}

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

function OcrField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-ink-mute">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

function OcrDocumentPreview({
  filename,
  preview,
}: {
  filename: string;
  preview: { url: string; mime: string };
}) {
  const isImage = preview.mime.startsWith('image/');
  const isPdf = preview.mime === 'application/pdf';

  return (
    <div className="lg:sticky lg:top-4">
      <p className="eyebrow mb-2">Pièce justificative</p>
      <div className="overflow-hidden rounded-xs border border-line bg-canvas">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.url}
            alt={filename}
            className="max-h-[70vh] w-full object-contain"
          />
        ) : isPdf ? (
          <iframe src={preview.url} title={filename} className="h-[70vh] w-full border-0" />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <FileIcon filename={filename} />
            <p className="text-xs text-ink-mute">Aperçu indisponible pour ce format.</p>
          </div>
        )}
      </div>
      <a
        href={preview.url}
        download={filename}
        className="press mt-2 inline-flex h-7 items-center gap-1.5 rounded-xs border border-line px-2 text-xs text-ink-soft transition-colors duration-fast hover:border-accent hover:text-accent-ink"
      >
        <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
        Télécharger
      </a>
    </div>
  );
}

function OcrPanel({
  ocr,
  filename,
  docPreview,
  chargeAccount,
  setChargeAccount,
  onCreate,
  creating,
}: {
  ocr: OcrResult;
  filename: string;
  docPreview: { url: string; mime: string } | null;
  chargeAccount: string;
  setChargeAccount: (v: string) => void;
  onCreate: () => void;
  creating: boolean;
}) {
  const invoice = ocr.extractedMetadata?.invoice;
  const proposed = ocr.extractedMetadata?.proposedEntry;
  const totals = invoice?.totals;

  const skip = ocr.extractedMetadata?.ocrSkip;

  if (!invoice && !proposed) {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {docPreview && <OcrDocumentPreview filename={filename} preview={docPreview} />}
        <div className="space-y-3">
          <p className="text-xs text-ink-mute">
            Aucune donnée structurée n&apos;a été extraite de ce document.
          </p>
          {skip && (
            <div className="space-y-2">
              <p className="eyebrow">Diagnostic OCR · moteur {skip.engine}</p>
              <ul className="space-y-1">
                {skip.checks.map((c) => (
                  <li key={c.name} className="flex items-start gap-2 text-xs">
                    <span
                      className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        c.ok ? 'bg-accent-soft text-accent-ink' : 'bg-critical-soft text-critical-ink'
                      }`}
                      aria-hidden
                    >
                      {c.ok ? '✓' : '✗'}
                    </span>
                    <span className="text-ink-soft">
                      <span className="font-medium text-ink">{c.name}</span>
                      {c.detail ? <span className="text-ink-mute"> — {c.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      {docPreview && <OcrDocumentPreview filename={filename} preview={docPreview} />}
      <div className="space-y-5">
      <div>
        <p className="eyebrow mb-2">Données extraites</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <OcrField label="Fournisseur" value={invoice?.supplier?.name ?? '—'} />
          <OcrField label="N° facture" value={invoice?.invoiceNumber ?? '—'} />
          <OcrField label="Date" value={invoice?.invoiceDate ?? '—'} />
          <OcrField label="N° ERP" value={invoice?.erpInvoiceNumber ?? '—'} />
          <OcrField label="Total HT" value={formatAmount(totals?.totalHt)} />
          <OcrField label="TVA" value={formatAmount(totals?.totalVat)} />
          <OcrField label="Total TTC" value={formatAmount(totals?.totalTtc)} />
          <OcrField label="Mode paiement" value={invoice?.paymentMode ?? '—'} />
        </dl>

        {invoice?.lines && invoice.lines.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xs border border-line">
            <table className="w-full text-xs">
              <thead className="bg-sunk text-ink-mute">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Désignation</th>
                  <th className="px-2 py-1 text-right font-medium">Qté</th>
                  <th className="px-2 py-1 text-right font-medium">P.U HT</th>
                  <th className="px-2 py-1 text-right font-medium">Montant HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoice.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 text-ink">{l.designation ?? '—'}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-ink-soft">
                      {l.quantity ?? '—'}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-ink-soft">
                      {formatAmount(l.unitPriceHt)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-ink">
                      {formatAmount(l.amountHt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {proposed && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="eyebrow">Proposition d&apos;écriture (achat)</p>
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                proposed.balanced
                  ? 'bg-accent-soft text-accent-ink'
                  : 'bg-critical-soft text-critical-ink'
              }`}
            >
              {proposed.balanced ? 'Équilibrée' : 'Déséquilibrée'}
            </span>
            <span className="text-xs text-ink-mute">
              Journal {proposed.journalCode} · {proposed.entryDate ?? '—'}
              {proposed.reference ? ` · réf ${proposed.reference}` : ''}
            </span>
          </div>

          <div className="overflow-hidden rounded-xs border border-line">
            <table className="w-full text-xs">
              <thead className="bg-sunk text-ink-mute">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Compte</th>
                  <th className="px-2 py-1 text-left font-medium">Libellé</th>
                  <th className="px-2 py-1 text-right font-medium">Débit</th>
                  <th className="px-2 py-1 text-right font-medium">Crédit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {proposed.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 font-mono text-ink">{l.accountCode}</td>
                    <td className="px-2 py-1 text-ink-soft">{l.description ?? '—'}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-ink">
                      {l.debit > 0 ? formatAmount(l.debit) : ''}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-ink">
                      {l.credit > 0 ? formatAmount(l.credit) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {proposed.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {proposed.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-ink-mute">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.5} /> {w}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Compte de charge</Label>
              <Input
                value={chargeAccount}
                onChange={(e) => setChargeAccount(e.target.value)}
                placeholder="601000"
                className="w-32 font-mono"
              />
            </div>
            <Button type="button" onClick={onCreate} disabled={creating || !proposed.balanced} className="press">
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FilePlus2 className="mr-2 h-4 w-4" />
              )}
              Créer l&apos;écriture
            </Button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
