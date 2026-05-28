'use client';

import {
  BarChart3,
  BookText,
  Calculator,
  Clock,
  FileSpreadsheet,
  FileText,
  GitBranch,
  History,
  Layers,
  PieChart,
  Scale,
  Stethoscope,
  TrendingUp,
  Upload,
  Wallet,
  FlaskConical,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Navigation groupée des 13 états financiers — direction « éditorial
 * papier ivoire » de DESIGN.md.
 *
 * Les 13 rapports sont arrangés en 4 sections sémantiques :
 *   1. Balances        — la matière première du retraitement
 *   2. États OHADA     — les livrables réglementaires SYSCOHADA
 *   3. Analyses        — la lecture managériale (ratios, trésorerie)
 *   4. Détail & contrôle — granularité ligne par ligne + outil diag.
 *
 * Le rapport actif est marqué avec un fond `accent-soft` + bordure
 * `accent`, jamais avec slate-900 (off-brand). Chiffre d'étape supprimé
 * — la nav est consultative, pas pédagogique comme /imports.
 */

export type ReportMode =
  | 'balance-sheet'
  | 'profit-loss'
  | 'trial-balance'
  | 'comparative-balance'
  | 'multi-year-balance'
  | 'sig'
  | 'ratios'
  | 'cash-trend'
  | 'aging-balance'
  | 'tft'
  | 'annexe'
  | 'margin-by-axis'
  | 'general-ledger'
  | 'import-diagnostic'
  | 'bilan-diagnostic'
  | 'balance-upload';

interface ReportItem {
  readonly mode: ReportMode;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly hint: string;
}

interface ReportGroup {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly items: ReadonlyArray<ReportItem>;
}

const REPORT_GROUPS: ReadonlyArray<ReportGroup> = [
  {
    key: 'balances',
    title: 'Balances',
    subtitle: 'La matière première du retraitement',
    items: [
      {
        mode: 'trial-balance',
        label: 'Balance générale',
        icon: BarChart3,
        hint: 'Tous les comptes sur une période, avec filtres classe et tranche.',
      },
      {
        mode: 'comparative-balance',
        label: 'Comparative N / N-1',
        icon: FileSpreadsheet,
        hint: 'Variation par compte entre deux exercices.',
      },
      {
        mode: 'multi-year-balance',
        label: 'Pluri-exercices',
        icon: History,
        hint: 'Évolution sur 3 à 5 ans, vue de tendance.',
      },
      {
        mode: 'aging-balance',
        label: 'Balance âgée',
        icon: Clock,
        hint: 'Tiers en retard de paiement par tranche de jours.',
      },
    ],
  },
  {
    key: 'ohada',
    title: 'États OHADA',
    subtitle: 'Livrables réglementaires SYSCOHADA-AUDCIF',
    items: [
      {
        mode: 'balance-sheet',
        label: 'Bilan',
        icon: Scale,
        hint: 'Actif et passif à une date — patrimoine et financement, hiérarchie DSF (35 postes lettrés).',
      },
      {
        mode: 'profit-loss',
        label: 'Compte de résultat',
        icon: PieChart,
        hint: "Charges, produits et résultat de l'exercice — vue classique pour la liasse fiscale.",
      },
      {
        mode: 'sig',
        label: 'SIG',
        icon: TrendingUp,
        hint: "Soldes intermédiaires de gestion, du chiffre d'affaires au résultat net.",
      },
      {
        mode: 'tft',
        label: 'TFT',
        icon: GitBranch,
        hint: 'Tableau des flux de trésorerie (méthode directe) — remplace le TAFIRE depuis SYSCOHADA 2017.',
      },
      {
        mode: 'annexe',
        label: 'Annexe',
        icon: FileText,
        hint: 'Notes annexes — politiques comptables, détail des postes.',
      },
    ],
  },
  {
    key: 'analyses',
    title: 'Analyses',
    subtitle: 'Lecture managériale et indicateurs',
    items: [
      {
        mode: 'ratios',
        label: 'Ratios financiers',
        icon: Calculator,
        hint: 'Liquidité, solvabilité, rentabilité, structure.',
      },
      {
        mode: 'cash-trend',
        label: 'Trésorerie glissante',
        icon: Wallet,
        hint: 'Position de trésorerie nette sur les 12 derniers mois.',
      },
      {
        mode: 'margin-by-axis',
        label: 'Marge par activité',
        icon: Layers,
        hint: 'Décomposition par axe analytique (centre, projet, produit).',
      },
    ],
  },
  {
    key: 'detail',
    title: 'Détail & contrôle',
    subtitle: 'Granularité ligne par ligne et diagnostic',
    items: [
      {
        mode: 'general-ledger',
        label: 'Grand livre',
        icon: BookText,
        hint: 'Mouvements chronologiques par compte avec cumul.',
      },
      {
        mode: 'import-diagnostic',
        label: "Diagnostic d'import",
        icon: Stethoscope,
        hint: "Anomalies sur les écritures issues d'un import récent.",
      },
      {
        mode: 'bilan-diagnostic',
        label: 'Diagnostic bilan',
        icon: FlaskConical,
        hint: "Vérification de l'équilibre journal (Σdébit = Σcrédit), décomposition par classe, checklist travaux de fin d'exercice SYSCOHADA.",
      },
    ],
  },
  {
    key: 'simulation',
    title: 'Simulation',
    subtitle: 'Générer des états sans écritures validées',
    items: [
      {
        mode: 'balance-upload',
        label: 'Balance personnalisée',
        icon: Upload,
        hint: 'Uploadez une balance CSV pour générer Bilan et CR sans passer par les journaux.',
      },
    ],
  },
];

interface ReportNavProps {
  readonly active: ReportMode;
  readonly onChange: (mode: ReportMode) => void;
}

export function ReportNav({ active, onChange }: ReportNavProps) {
  return (
    <nav
      aria-label="Sélection du rapport"
      className="rounded-md border border-line bg-paper"
    >
      <ul className="divide-y divide-line">
        {REPORT_GROUPS.map((group) => (
          <li key={group.key} className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-[180px_1fr]">
            <div className="min-w-0">
              <p className="font-display text-base font-medium leading-tight tracking-tight text-ink">
                {group.title}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-ink-mute">{group.subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => {
                const isActive = active === item.mode;
                const Icon = item.icon;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => onChange(item.mode)}
                    title={item.hint}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      isActive
                        ? 'border-accent bg-accent-soft text-accent-ink'
                        : 'border-line-strong bg-paper text-ink-soft hover:border-ink hover:bg-sunk hover:text-ink',
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon
                      className={cn('h-3.5 w-3.5', isActive ? 'text-accent' : 'text-ink-mute')}
                      strokeWidth={1.5}
                    />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Résolveur d'aide en bas de nav : pour un mode donné, renvoie le hint
 * du rapport correspondant. Utilisé pour la légende sous le header de
 * la page (« Vous consultez : <hint> »).
 */
export function getReportHint(mode: ReportMode): string {
  for (const group of REPORT_GROUPS) {
    for (const item of group.items) {
      if (item.mode === mode) {
        return item.hint;
      }
    }
  }
  return '';
}

export function getReportLabel(mode: ReportMode): string {
  for (const group of REPORT_GROUPS) {
    for (const item of group.items) {
      if (item.mode === mode) {
        return item.label;
      }
    }
  }
  return '';
}
