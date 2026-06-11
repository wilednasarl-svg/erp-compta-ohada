'use client';

import { CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api, getAuthToken } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';
import type { ImportSourceType, SessionSummary } from '@/types/imports';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/** Logiciels d'origine pris en charge — affichés en bandeau de réassurance. */
const COMPATIBLE_SOURCES = ['Sage', 'Ciel', 'EBP', 'Odoo', 'Excel', 'FEC'] as const;

/** Devine le `sourceType` à partir de l'extension (le backend reste l'autorité). */
function sourceTypeFromName(name: string): ImportSourceType {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.txt')) return 'txt';
  return 'csv';
}

interface SessionResponse {
  readonly session: SessionSummary;
}

/**
 * Carte d'entrée d'import sur l'accueil (dossier neuf surtout) :
 *   1. bandeau de compatibilité multi-logiciels (réassurance « sans ressaisie ») ;
 *   2. zone glisser-déposer qui crée une session, téléverse le fichier et
 *      saute directement à la vérification (`/imports?session=<id>`).
 *
 * Composant autonome : récupère l'org via le store, gère sa propre
 * mutation. Aucune prop requise — câblage minimal côté accueil.
 */
export function HomeImport() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const [isDragOver, setIsDragOver] = useState(false);

  const startImport = useApiMutation(
    async (file: File) => {
      if (orgId === '') {
        throw new ApiError(400, { code: 'ORG_REQUIRED', message: 'Aucun dossier actif.' });
      }
      // 1. Créer la session (type par défaut : écritures — modifiable ensuite).
      const created = await api.post<SessionResponse>(
        `/organizations/${orgId}/imports/sessions`,
        { sourceType: sourceTypeFromName(file.name), documentType: 'entries' },
      );
      const sessionId = created.session.id;

      // 2. Téléverser le fichier (multipart — hors client JSON).
      const fd = new FormData();
      fd.append('file', file);
      const token = getAuthToken();
      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/imports/sessions/${sessionId}/files`,
        {
          method: 'POST',
          headers: token === null ? {} : { Authorization: `Bearer ${token}` },
          body: fd,
        },
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const env = (await res.json()) as { error?: { message?: string } };
          message = env.error?.message ?? message;
        } catch {
          /* réponse non-JSON — on garde le HTTP code */
        }
        throw new ApiError(res.status, { code: 'IMPORT_UPLOAD_FAILED', message });
      }
      return sessionId;
    },
    {
      onSuccess: (sessionId) => {
        // 3. Sauter à la session (vérification du mapping).
        router.push(`/imports?session=${sessionId}`);
      },
    },
  );

  const onFile = (file: File | null | undefined) => {
    if (file && !startImport.isPending) startImport.mutate(file);
  };

  return (
    <section
      aria-labelledby="home-import-title"
      className="border-y border-line bg-paper"
    >
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1">Porte d&apos;entrée</p>
          <h2 id="home-import-title" className="font-display text-lg font-medium tracking-tight text-ink">
            Importez vos données — sans ressaisie
          </h2>
          <p className="mt-1 max-w-[52ch] text-xs leading-relaxed text-ink-soft">
            Reprenez le travail d&apos;un autre logiciel : déposez un export et l&apos;app
            l&apos;ingère telle quelle.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {COMPATIBLE_SOURCES.map((s) => (
              <span
                key={s}
                className="rounded-xs border border-line bg-sunk/50 px-1.5 py-0.5 text-2xs font-medium text-ink-soft"
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div className="w-full sm:w-[20rem]">
          <label
            htmlFor="home-import-file"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              onFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              'press flex cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border-2 border-dashed px-4 py-5 text-center transition-colors duration-fast',
              isDragOver
                ? 'border-accent bg-accent-soft/40'
                : 'border-line-strong bg-sunk/40 hover:border-accent',
              startImport.isPending && 'pointer-events-none opacity-70',
            )}
          >
            {startImport.isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-ink-soft" />
                <span className="text-xs font-medium text-ink-soft">Analyse en cours…</span>
              </>
            ) : (
              <>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-paper text-ink-soft">
                  <Upload className="h-4 w-4" strokeWidth={1.5} />
                </span>
                <span className="text-xs font-medium text-ink">
                  Glissez un fichier ici, ou cliquez
                </span>
                <span className="text-2xs text-ink-mute">.csv .xlsx .txt .pdf .fec</span>
              </>
            )}
            <input
              id="home-import-file"
              type="file"
              accept=".csv,.xlsx,.xls,.txt,.pdf,.fec"
              className="sr-only"
              disabled={startImport.isPending}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {startImport.error && (
            <p className="mt-2 text-2xs text-critical-ink">
              {startImport.error.message} — vous pouvez aussi passer par la{' '}
              <a href="/imports" className="font-medium underline">
                page Imports
              </a>
              .
            </p>
          )}
          {startImport.isSuccess && (
            <p className="mt-2 text-2xs font-medium text-accent-ink">
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              Fichier reçu — ouverture de la vérification…
            </p>
          )}
          <a
            href="/imports"
            className="mt-2 inline-flex items-center gap-1 text-2xs text-ink-mute underline-offset-2 hover:text-ink hover:underline"
          >
            <FileUp className="h-3 w-3" />
            Voir tous les imports
          </a>
        </div>
      </div>
    </section>
  );
}
