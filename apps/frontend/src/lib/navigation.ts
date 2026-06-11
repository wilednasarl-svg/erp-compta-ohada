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
  Landmark,
  LayoutDashboard,
  Link2,
  type LucideIcon,
  Mail,
  Package,
  Paperclip,
  PenLine,
  Percent,
  PieChart,
  Rows3,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  Upload,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';

/**
 * Centralized navigation model. Consumed by `app-shell` (sidebar) and
 * `command-palette` (⌘K) so they never drift.
 *
 * Organisé en PIPELINE MÉTIER — chaque groupe est une étape du cycle
 * comptable et répond à un problème précis, dans l'ordre où le dossier
 * avance (et non par type de fonctionnalité) :
 *
 *   1. Pilotage              — où en est le dossier aujourd'hui ?
 *   2. Alimenter             — faire entrer les données, zéro ressaisie
 *   3. Fiabiliser            — des comptes justes : pointer, lettrer, corriger
 *   4. Clôturer              — travaux d'inventaire et de fin d'exercice
 *   5. Conformité SYSCOHADA  — un dossier conforme AUDCIF, prouvable
 *   6. États & déclarations  — produire le jeu d'états et déclarer
 *   7. Analyse & décision    — comprendre les chiffres et décider
 *   8. Référentiel & équipe  — socle du dossier et gestion du cabinet
 *
 * Règle de placement : un module rejoint l'étape où il RÉSOUT le
 * problème de l'utilisateur, pas celle où il range ses données (ex. les
 * Immobilisations vivent dans « Clôturer » — c'est un travail
 * d'inventaire — pas dans « États »).
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
      { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, hint: 'Vue du jour : priorités, score, trésorerie' },
      { href: '/welcome', label: 'Guide', icon: Compass, hint: 'Documentation interactive — par où commencer' },
    ],
  },
  {
    title: 'Alimenter',
    items: [
      { href: '/imports', label: 'Imports', icon: FileUp, hint: 'Sage, Ciel, EBP, Odoo, Excel, FEC — zéro ressaisie' },
      { href: '/journals', label: 'Journaux', icon: BookText, hint: 'Saisie et consultation des écritures' },
      { href: '/entry-workflow', label: 'Workflow écritures', icon: PenLine, hint: 'Validation préparateur / valideur' },
      { href: '/documents', label: 'Pièces & documents', icon: Paperclip, hint: 'GED — pièces justificatives rattachées' },
    ],
  },
  {
    title: 'Fiabiliser',
    items: [
      { href: '/lettering', label: 'Lettrage', icon: Link2, hint: 'Comptes 40x · 41x, clients/fournisseurs' },
      { href: '/bank-reconciliation', label: 'Rapprochement', icon: Banknote, hint: 'Pointer relevés bancaires' },
      { href: '/aging', label: 'Échéancier', icon: CalendarClock, hint: 'Balance âgée clients / fournisseurs' },
      { href: '/collections', label: 'Recouvrement', icon: Mail, hint: 'Relances clients et export des créances' },
      { href: '/ai', label: 'IA — Anomalies', icon: Brain, hint: 'Détection d’écritures suspectes et mapping intelligent' },
      { href: '/rules', label: 'Règles', icon: Sparkles, hint: 'Automatisations comptables' },
      { href: '/workflows', label: 'Workflows', icon: GitBranch, hint: 'Séquences automatisées' },
    ],
  },
  {
    title: 'Clôturer',
    items: [
      { href: '/accounting-periods', label: 'Périodes & clôtures', icon: Calendar, hint: 'Exercices, mois, verrouillage' },
      { href: '/assets', label: 'Immobilisations', icon: Package, hint: 'Amortissements et dotations' },
      { href: '/inventory', label: 'Inventaire', icon: Warehouse, hint: 'Stocks et inventaire physique' },
      { href: '/provisions', label: 'Provisions', icon: ShieldCheck, hint: 'Provisions pour risques & charges (classe 19)' },
      { href: '/impairments', label: 'Dépréciations', icon: TrendingDown, hint: 'Tests de valeur actifs & stocks (classe 29/39)' },
      { href: '/subsidies', label: 'Subventions', icon: Landmark, hint: 'Subventions d’investissement & reprises (compte 1411/799)' },
      { href: '/bills-of-exchange', label: 'Effets de commerce', icon: ScrollText, hint: 'Lettres de change & billets à ordre (402/412)' },
      { href: '/transformations', label: 'Transformations', icon: ArrowRightLeft, hint: 'Retraitements et recalculs' },
    ],
  },
  {
    title: 'Conformité SYSCOHADA',
    items: [
      { href: '/syscohada-compliance', label: 'Conformité AUDCIF', icon: ShieldCheck, hint: 'Détection d’anomalies AUDCIF & recommandations' },
      { href: '/accounting-score', label: 'Score santé', icon: Award, hint: 'Indice qualité OHADA du dossier' },
      { href: '/syscohada-knowledge', label: 'Doctrine SYSCOHADA', icon: BookOpenCheck, hint: 'Citations du Guide par module' },
      { href: '/audit-logs', label: 'Audit', icon: History, hint: 'Traçabilité et journal des actions' },
    ],
  },
  {
    title: 'États & déclarations',
    items: [
      { href: '/reports/console', label: 'États financiers', icon: BarChart3, hint: 'Parcours guidé : Bilan, CR, TFT, SIG, Annexe, balances & diagnostics (16 états)' },
      { href: '/grand-livre', label: 'Grand-livre', icon: Rows3, hint: 'Balance par compte + détail des écritures' },
      { href: '/tva', label: 'TVA', icon: Percent, hint: 'Déclarations UEMOA / DGI' },
      { href: '/tax-breakdown', label: 'Ventilation TVA', icon: Percent, hint: 'Cumuls par code taxe' },
      { href: '/fiscal', label: 'Fiscal & social', icon: Landmark, hint: 'Échéancier IS/TVA/CNPS, déclarations' },
    ],
  },
  {
    title: 'Analyse & décision',
    items: [
      { href: '/dashboards', label: 'Dashboards', icon: Gauge, hint: 'KPIs détaillés par exercice' },
      { href: '/dashboards/treasury', label: 'Trésorerie & Cash', icon: Wallet, hint: 'Jours de cash, soldes par banque, alertes' },
      { href: '/dashboards/profitability', label: 'Rentabilité', icon: PieChart, hint: 'Marge par activité, client, projet, zone' },
      { href: '/budget', label: 'Budget vs Réalisé', icon: Target, hint: 'Écarts budgétaires et taux de consommation' },
      { href: '/budget/saisie', label: 'Saisie & import budget', icon: FileUp, hint: 'Modèle Excel : remplir puis réimporter, ou saisir' },
      { href: '/dashboards/consolidated', label: 'Vue consolidée', icon: BarChart3, hint: 'Multi-dossiers' },
    ],
  },
  {
    title: 'Référentiel & équipe',
    items: [
      { href: '/chart-of-accounts', label: 'Plan comptable', icon: BookOpen, hint: 'SYSCOHADA — comptes et classes' },
      { href: '/chart-of-accounts/import', label: 'Importer un plan', icon: Upload, hint: 'Charger un plan comptable CSV / Excel' },
      { href: '/currencies', label: 'Devises', icon: Coins, hint: 'XOF, EUR, USD et taux' },
      { href: '/collaboration', label: 'Collaboration', icon: Handshake, hint: 'Commentaires et tâches partagées' },
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
