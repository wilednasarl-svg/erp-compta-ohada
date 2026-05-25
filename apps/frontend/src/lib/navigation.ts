import {
  ArrowRightLeft,
  Award,
  Banknote,
  BarChart3,
  BookOpen,
  BookText,
  Brain,
  Calendar,
  Coins,
  FileUp,
  Gauge,
  GitBranch,
  Handshake,
  History,
  LayoutDashboard,
  Link2,
  type LucideIcon,
  Mail,
  Package,
  Paperclip,
  PenLine,
  Percent,
  ShieldCheck,
  Sparkles,
  Users,
  Warehouse,
} from 'lucide-react';

/**
 * Centralized navigation model. Consumed by `app-shell` (sidebar) and
 * `command-palette` (⌘K) so they never drift. Grouped by domain in the
 * exact order an accountant moves through a typical day:
 *
 *   1. Pilotage      — orientation, health, dashboards
 *   2. Référentiel   — static data (chart of accounts, periods, FX)
 *   3. Saisie        — recording activity (journals, imports, workflow)
 *   4. Retraitement  — reconciliation work
 *   5. États         — statutory outputs (financials, VAT, inventory)
 *   6. IA            — automation surfaces
 *   7. Organisation  — admin & traceability
 */
export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly hint?: string;
}

export interface NavGroup {
  readonly title: string;
  readonly items: ReadonlyArray<NavItem>;
}

export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    title: 'Pilotage',
    items: [
      { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, hint: 'Vue du jour' },
      { href: '/dashboards', label: 'Dashboards', icon: Gauge, hint: 'KPIs détaillés' },
      { href: '/accounting-score', label: 'Score santé', icon: Award, hint: 'Indice OHADA' },
    ],
  },
  {
    title: 'Référentiel',
    items: [
      { href: '/chart-of-accounts', label: 'Plan comptable', icon: BookOpen, hint: 'SYSCOHADA' },
      { href: '/accounting-periods', label: 'Périodes', icon: Calendar, hint: 'Exercices, clôtures' },
      { href: '/currencies', label: 'Devises', icon: Coins, hint: 'XOF, EUR, USD' },
    ],
  },
  {
    title: 'Saisie',
    items: [
      { href: '/journals', label: 'Journaux', icon: BookText, hint: 'Écritures comptables' },
      { href: '/entry-workflow', label: 'Workflow écritures', icon: PenLine, hint: 'Validation' },
      { href: '/imports', label: 'Imports', icon: FileUp, hint: 'Sage, CSV, PDF' },
    ],
  },
  {
    title: 'Retraitement',
    items: [
      { href: '/lettering', label: 'Lettrage', icon: Link2 },
      { href: '/bank-reconciliation', label: 'Rapprochement', icon: Banknote },
      { href: '/transformations', label: 'Transformations', icon: ArrowRightLeft },
      { href: '/rules', label: 'Règles', icon: Sparkles, hint: 'Automatisations' },
    ],
  },
  {
    title: 'États',
    items: [
      { href: '/reports', label: 'États financiers', icon: BarChart3, hint: 'Bilan, compte de résultat' },
      { href: '/tva', label: 'TVA', icon: Percent, hint: 'Déclarations UEMOA' },
      { href: '/inventory', label: 'Inventaire', icon: Warehouse },
      { href: '/assets', label: 'Immobilisations', icon: Package },
    ],
  },
  {
    title: 'IA & Automation',
    items: [
      { href: '/ai', label: 'IA — Anomalies', icon: Brain, hint: 'Détection, mapping' },
      { href: '/workflows', label: 'Workflows', icon: GitBranch },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { href: '/collaboration', label: 'Collaboration', icon: Handshake },
      { href: '/documents', label: 'Documents', icon: Paperclip },
      { href: '/audit-logs', label: 'Audit', icon: History, hint: 'Traçabilité' },
      { href: '/members', label: 'Membres', icon: Users },
      { href: '/invitations', label: 'Invitations', icon: Mail },
      { href: '/settings/mfa', label: 'MFA', icon: ShieldCheck, hint: 'Sécurité' },
    ],
  },
];

/** Flat list — used by the command palette for search. */
export const NAV_FLAT: ReadonlyArray<NavItem & { group: string }> = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.title })),
);
