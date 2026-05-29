'use client';

/**
 * DataValidityStrip — dit à l'utilisateur, AVANT génération, si l'état sera
 * fiable. Trois questions qu'un comptable se pose toujours et que l'interface
 * actuelle laisse sans réponse :
 *   1. Y a-t-il des écritures sur la période ?  (sinon l'état sera vide)
 *   2. Le journal est-il équilibré ?            (Σdébit = Σcrédit)
 *   3. Les données sont-elles à jour / figées ? (clôture, dernier mouvement)
 *
 * Sémantique couleur stricte (DESIGN.md) : accent = sain, critical = bloquant,
 * warn = attention. Jamais de couleur décorative.
 */

import { CheckCircle2, CircleAlert, Clock, Lock, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

import { InfoTip } from './info-tip';
import { formatHuman } from './presets';
import type { PeriodValidity } from './types';

interface DataValidityStripProps {
  readonly validity: PeriodValidity | undefined;
  readonly loading?: boolean;
}

const formatFcfa = (n: number): string =>
  `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n)} FCFA`;

const relativeFreshness = (computedAt: string): string => {
  const diffMin = Math.round((Date.now() - new Date(computedAt).getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  return `il y a ${Math.round(diffH / 24)} j`;
};

function Indicator({
  icon: Icon,
  tone,
  children,
  tip,
  tipLabel,
}: {
  readonly icon: typeof CheckCircle2;
  readonly tone: 'ok' | 'warn' | 'critical' | 'neutral';
  readonly children: React.ReactNode;
  readonly tip: React.ReactNode;
  readonly tipLabel: string;
}) {
  const toneCls = {
    ok: 'text-accent-ink',
    warn: 'text-warn',
    critical: 'text-critical-ink',
    neutral: 'text-ink-soft',
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className={cn('h-3.5 w-3.5', toneCls)} strokeWidth={1.5} aria-hidden />
      <span className={cn('text-xs', toneCls)}>{children}</span>
      <InfoTip label={tipLabel}>{tip}</InfoTip>
    </span>
  );
}

export function DataValidityStrip({ validity, loading }: DataValidityStripProps) {
  if (loading || !validity) {
    return (
      <div className="flex h-7 items-center gap-2 text-xs text-ink-mute" aria-live="polite">
        <Clock className="h-3.5 w-3.5 animate-pulse" strokeWidth={1.5} aria-hidden />
        Analyse de la période…
      </div>
    );
  }

  const empty = validity.committedEntries === 0;
  const balanced = validity.imbalance === 0;

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-sm border border-line bg-sunk/40 px-3 py-1.5"
      role="status"
    >
      <Indicator
        icon={empty ? CircleAlert : CheckCircle2}
        tone={empty ? 'warn' : 'ok'}
        tipLabel="Écritures sur la période"
        tip={
          empty
            ? "Aucune écriture committée sur cette période. L'état généré sera vide."
            : 'Nombre d’écritures committées agrégées dans cet état.'
        }
      >
        {empty ? 'Aucune écriture' : `${validity.committedEntries.toLocaleString('fr-FR')} écritures`}
      </Indicator>

      <Indicator
        icon={balanced ? CheckCircle2 : TriangleAlert}
        tone={balanced ? 'ok' : 'critical'}
        tipLabel="Équilibre du journal"
        tip={
          balanced
            ? 'Σ débit = Σ crédit sur la période. Le bilan pourra équilibrer.'
            : `Écart Σdébit − Σcrédit de ${formatFcfa(validity.imbalance)}. Un Bilan ou un CR généré maintenant sera déséquilibré.`
        }
      >
        {balanced ? 'Journal équilibré' : `Écart ${formatFcfa(validity.imbalance)}`}
      </Indicator>

      {validity.lastMovementDate && (
        <Indicator
          icon={Clock}
          tone="neutral"
          tipLabel="Dernier mouvement"
          tip="Date de l’écriture la plus récente prise en compte dans la période."
        >
          Dernier mouvement {formatHuman(validity.lastMovementDate)}
        </Indicator>
      )}

      {validity.periodClosed && (
        <Indicator
          icon={Lock}
          tone="ok"
          tipLabel="Période clôturée"
          tip="La période est verrouillée : l’état est définitif et ne changera plus."
        >
          Période clôturée
        </Indicator>
      )}

      <span className="ml-auto text-2xs text-ink-mute">
        Analyse {relativeFreshness(validity.computedAt)}
      </span>
    </div>
  );
}
