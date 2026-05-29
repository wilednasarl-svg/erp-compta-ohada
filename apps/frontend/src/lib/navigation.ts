import {
  ArrowRightLeft,
  Award,
  Banknote,
  BarChart3,
  BookOpen,
  BookOpenCheck,
  BookText,
  Brain,
  Calendar,
  CalendarClock,
  Coins,
  Compass,
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
  SlidersHorizontal,
  Sparkles,
  Users,
  Warehouse,
} from 'lucide-react';

/**
 * Centralized navigation model. Consumed by `app-shell` (sidebar) and
 * `command-palette` (⌘K) so they never drift. Grouped by domain in the
 * exact order an accountant moves through a typical day:
 *
 *   1. Pilotage      — orientation, tableau de bord, dashboards
 *   2. Référentiel   — données statiques (plan comptable, périodes, FX)
 *   3. Saisie        — enregistrement (journaux, imports, workflow)
 *   4. Retraitement  — travaux de retraitement
 *   5. États         — sorties statutaires (financiers, TVA, inventaire)
 *   6. Analyse & IA  — score santé, anomalies, automatisations
 *   7. Organisation  — administration et traçabilité
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
      { href: '/welcome', label: 'Guide', icon: Compass, hint: 'Documentation interactive' },
      { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, hint: 'Vue du jour et priorités' },
      { href: '/dashboards', label: 'Dashboards', icon: Gauge, hint: 'KPIs détaillés par exercice' },
      { href: '/dashboards/consolidated', label: 'Vue consolidée', icon: BarChart3, hint: 'Multi-dossiers' },
    ],
  },
  {
    title: 'Référentiel',
    items: [
      { href: '/chart-of-accounts', label: 'Plan comptable', icon: BookOpen, hint: 'SYSCOHADA — comptes et classes' },
      { href: '/syscohada-knowledge', label: 'Doctrine SYSCOHADA', icon: BookOpenCheck, hint: 'Citations du Guide par module' },
      { href: '/accounting-periods', label: 'Périodes', icon: Calendar, hint: 'Exercices, mois, clôtures' },
      { href: '/currencies', label: 'Devises', icon: Coins, hint: 'XOF, EUR, USD et taux' },
    ],
  },
  {
    title: 'Saisie',
    items: [
      { href: '/journals', label: 'Journaux', icon: BookText, hint: 'Écritures comptables' },
      { href: '/entry-workflow', label: 'Workflow écritures', icon: PenLine, hint: 'Validation préparateur / valideur' },
      { href: '/imports', label: 'Imports', icon: FileUp, hint: 'Sage Saari, CSV, PDF' },
    ],
  },
  {
    title: 'Retraitement',
    items: [
      { href: '/lettering', label: 'Lettrage', icon: Link2, hint: 'Comptes 40x · 41x, clients/fournisseurs' },
      { href: '/aging', label: 'Échéancier', icon: CalendarClock, hint: 'Balance âgée clients / fournisseurs' },
      { href: '/bank-reconciliation', label: 'Rapprochement', icon: Banknote, hint: 'Pointer relevés bancaires' },
      { href: '/transformations', label: 'Transformations', icon: ArrowRightLeft, hint: 'Retraitements et recalculs' },
      { href: '/rules', label: 'Règles', icon: Sparkles, hint: 'Automatisations comptables' },
    ],
  },
  {
    title: 'États',
    items: [
      { href: '/reports', label: 'États financiers', icon: BarChart3, hint: 'Bilan, compte de résultat, TFT, SIG, Annexe' },
      { href: '/reports/console', label: 'Console des états', icon: SlidersHorizontal, hint: 'Parcours guidé : période → générer (14 états)' },
      { href: '/tva', label: 'TVA', icon: Percent, hint: 'Déclarations UEMOA / DGI' },
      { href: '/tax-breakdown', label: 'Ventilation TVA', icon: Percent, hint: 'Cumuls par code taxe' },
      { href: '/inventory', label: 'Inventaire', icon: Warehouse, hint: 'Stocks et inventaire physique' },
      { href: '/assets', label: 'Immobilisations', icon: Package, hint: 'Amortissements et dotations' },
    ],
  },
  {
    title: 'Analyse & IA',
    items: [
      { href: '/accounting-score', label: 'Score santé', icon: Award, hint: 'Indice qualité OHADA' },
      { href: '/ai', label: 'IA — Anomalies', icon: Brain, hint: 'Détection et mapping intelligent' },
      { href: '/workflows', label: 'Workflows', icon: GitBranch, hint: 'Séquences automatisées' },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { href: '/collaboration', label: 'Collaboration', icon: Handshake, hint: 'Commentaires et tâches partagées' },
      { href: '/documents', label: 'Documents', icon: Paperclip, hint: 'GED — pièces justificatives' },
      { href: '/audit-logs', label: 'Audit', icon: History, hint: 'Traçabilité et journal des actions' },
      { href: '/members', label: 'Membres', icon: Users, hint: 'Équipe du cabinet' },
      { href: '/invitations', label: 'Invitations', icon: Mail, hint: 'Inviter un collaborateur' },
      { href: '/settings/mfa', label: 'MFA', icon: ShieldCheck, hint: 'Double authentification' },
    ],
  },
];

/** Flat list — used by the command palette for search. */
export const NAV_FLAT: ReadonlyArray<NavItem & { group: string }> = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.title })),
);
