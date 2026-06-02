'use client';

import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ApiError, api } from '@/lib/api-client';
import type {
  SyscohadaControlSeverity,
  SyscohadaControlWithEvidence,
  SyscohadaModuleGuidance,
} from '@/types/syscohada-knowledge';

const SEVERITY_META: Record<
  SyscohadaControlSeverity,
  { readonly label: string; readonly className: string }
> = {
  blocking: { label: 'Bloquant', className: 'bg-critical-soft text-critical-ink' },
  warning: { label: 'À corriger', className: 'bg-warn-soft text-warn-ink' },
  info: { label: 'Bonne pratique', className: 'bg-info-soft text-info-ink' },
};

interface SyscohadaGuidancePanelProps {
  /**
   * Segment de route du module métier, tel qu'exposé côté backend :
   * `<module>/syscohada-guidance` (ex. `provisions`, `impairments`).
   */
  readonly module: string;
  /**
   * Titre du panneau. Par défaut « Conformité SYSCOHADA ». À préciser quand le
   * panneau est hébergé sur une page dont le thème diffère du domaine doctrinal
   * (ex. doctrine des contrats de location affichée sur la page Immobilisations).
   */
  readonly title?: string;
  /** Repli/déplié par défaut. Replié par défaut pour rester discret. */
  readonly defaultOpen?: boolean;
}

/**
 * Panneau « Conformité SYSCOHADA » réutilisable, branché sur l'endpoint
 * lecture seule `<module>/syscohada-guidance`. Affiche les contrôles doctrinaux
 * du module avec leur base légale (article AUDCIF / Guide) et l'extrait verbatim
 * sourcé. Net-new, sans dépendance aux services métier du module hôte.
 */
export function SyscohadaGuidancePanel({
  module,
  title = 'Conformité SYSCOHADA',
  defaultOpen = false,
}: SyscohadaGuidancePanelProps) {
  const guidanceQuery = useQuery<SyscohadaModuleGuidance, ApiError>({
    queryKey: ['syscohada-guidance', module],
    queryFn: async () => api.get<SyscohadaModuleGuidance>(`/${module}/syscohada-guidance`),
    staleTime: 1000 * 60 * 60, // doctrine quasi-statique
  });

  const guidance = guidanceQuery.data;
  const controls = guidance?.controls ?? [];
  const tomes = guidance
    ? [...new Set(guidance.references.map((r) => r.tome))].filter((t) => t > 0).sort((a, b) => a - b)
    : [];

  return (
    <details
      open={defaultOpen}
      className="group rounded-sm border border-line bg-paper [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm">
        <BookOpenCheck className="size-4 shrink-0 text-ink-mute" strokeWidth={1.5} aria-hidden />
        <span className="font-display font-medium text-ink">{title}</span>
        {controls.length > 0 && (
          <span className="font-mono text-xs tabular-nums text-ink-mute">
            {controls.length} contrôle{controls.length > 1 ? 's' : ''}
          </span>
        )}
        {tomes.length > 0 && (
          <span className="ml-auto rounded-xs bg-sunk px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-ink-mute">
            Tome {tomes.join(', ')}
          </span>
        )}
        <span
          className="text-ink-mute transition-transform duration-fast group-open:rotate-90"
          aria-hidden
        >
          ›
        </span>
      </summary>

      <div className="border-t border-line px-4 py-4">
        {guidanceQuery.isLoading ? (
          <GuidanceSkeleton />
        ) : guidanceQuery.error ? (
          <p className="rounded-xs bg-critical-soft px-3 py-2 text-xs text-critical-ink">
            Doctrine indisponible : {guidanceQuery.error.message}
          </p>
        ) : controls.length === 0 ? (
          <p className="text-xs text-ink-mute">
            Aucun contrôle SYSCOHADA n&apos;est encore rattaché à ce module.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="size-4 text-ink-mute" strokeWidth={1.5} aria-hidden />
              <span className="eyebrow">Contrôles &amp; bases légales</span>
            </div>
            <div className="space-y-4">
              {controls.map((control) => (
                <ControlRow key={control.id} control={control} />
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function ControlRow({ control }: { readonly control: SyscohadaControlWithEvidence }) {
  // Durcissement défensif : le backend peut servir une sévérité hors de l'enum
  // frontend (dérive openapi connue, cf. DOMAIN_LABELS) → repli neutre plutôt
  // que TypeError au rendu.
  const severity = SEVERITY_META[control.severity] ?? SEVERITY_META.info;
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink">{control.label}</p>
        <span
          className={cn(
            'shrink-0 rounded-xs px-2 py-0.5 text-2xs font-medium uppercase tracking-wider',
            severity.className,
          )}
        >
          {severity.label}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">{control.description}</p>
      {control.legalBasis.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {control.legalBasis.map((basis) => (
            <span key={basis} className="rounded-xs bg-sunk px-1.5 py-0.5 text-2xs text-ink-mute">
              {basis}
            </span>
          ))}
        </div>
      )}
      {control.citation && (
        <blockquote className="mt-2 rounded-xs bg-sunk px-3 py-2">
          <p className="text-xs italic text-ink-soft">
            « {control.citation.excerpt.slice(0, 200)}
            {control.citation.excerpt.length > 200 ? '…' : ''} »
          </p>
          <p className="mt-1 text-2xs text-ink-mute">
            Tome {control.citation.tome}, {control.citation.sourceTitle} · lignes{' '}
            {control.citation.lineStart}-{control.citation.lineEnd}
          </p>
        </blockquote>
      )}
    </div>
  );
}

function GuidanceSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i}>
          <div className="h-3.5 w-2/3 rounded-xs bg-sunk" />
          <div className="mt-1.5 h-3 w-full rounded-xs bg-sunk" />
        </div>
      ))}
    </div>
  );
}
