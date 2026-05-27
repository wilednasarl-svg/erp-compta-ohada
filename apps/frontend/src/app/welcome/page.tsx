import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import {
  Award, Banknote, BarChart3, BookOpen, BookText, Brain, Calendar,
  Coins, FileUp, Gauge, GitBranch, Handshake, History, LayoutDashboard,
  Link2, type LucideIcon, Mail, Package, Paperclip, PenLine, Percent,
  ShieldCheck, Sparkles, Users, Warehouse, ArrowRightLeft, ChevronRight, Play,
} from 'lucide-react';

import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'Guide de démarrage — ERP Compta OHADA',
  description: 'Découvrez les 7 modules de votre ERP comptable SYSCOHADA révisé.',
};

type Tone = 'info' | 'warn' | 'accent' | 'critical' | 'neutral';

interface ModuleItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string;
}

interface ModuleGroup {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly tagline: string;
  readonly description: string;
  readonly items: ReadonlyArray<ModuleItem>;
  readonly features: ReadonlyArray<string>;
  readonly tone: Tone;
  readonly Illustration: () => React.ReactElement;
}

const TONE_BORDER: Record<Tone, string> = {
  info: 'border-info',
  warn: 'border-warn',
  accent: 'border-accent',
  critical: 'border-critical',
  neutral: 'border-line-strong',
};

const TONE_SOFT_BG: Record<Tone, string> = {
  info: 'bg-info-soft text-info-ink',
  warn: 'bg-warn-soft text-warn-ink',
  accent: 'bg-accent-soft text-accent-ink',
  critical: 'bg-critical-soft text-critical-ink',
  neutral: 'bg-sunk text-ink-soft',
};

const TONE_PLAY_BG: Record<Tone, string> = {
  info: 'bg-info',
  warn: 'bg-warn',
  accent: 'bg-accent',
  critical: 'bg-critical',
  neutral: 'bg-ink-mute',
};

const MODULE_GROUPS: ReadonlyArray<ModuleGroup> = [
  {
    id: 'pilotage',
    number: '01',
    title: 'Pilotage',
    tagline: 'Vue d\'ensemble en temps réel de votre dossier comptable',
    description:
      'Le tableau de bord est votre point d\'entrée quotidien. Il centralise les priorités du jour (écritures à valider, rapprochements, déclarations TVA), l\'activité récente de l\'équipe, et l\'état de santé du dossier. Conçu comme un journal de bord éditorial — pas un tableau de métriques uniforme.',
    items: [
      { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, description: 'Vue quotidienne — priorités du jour, activité récente de l\'équipe, état du dossier.' },
      { href: '/dashboards', label: 'Dashboards KPIs', icon: Gauge, description: 'Indicateurs clés détaillés — chiffre d\'affaires, charges, trésorerie, ratios OHADA.' },
      { href: '/accounting-score', label: 'Score santé', icon: Award, description: 'Indice de qualité OHADA — cohérence des soldes, taux de lettrage, conformité TVA.' },
    ],
    features: [
      'Priorités du jour : écritures à valider, rapprochements, TVA à déclarer',
      'Activité en temps réel de toute l\'équipe comptable',
      'Score de santé OHADA calculé automatiquement',
      'KPIs avec graphiques interactifs et chiffres tabular-nums',
    ],
    tone: 'info',
    Illustration: PilotageIllustration,
  },
  {
    id: 'referentiel',
    number: '02',
    title: 'Référentiel',
    tagline: 'La fondation structurelle de votre comptabilité',
    description:
      'Le référentiel regroupe les données structurelles du dossier : le plan comptable SYSCOHADA révisé avec ses 8 classes, les périodes et exercices comptables avec clôtures automatisées, et la configuration multi-devises. Ces fondations conditionnent le fonctionnement de tous les autres modules.',
    items: [
      { href: '/chart-of-accounts', label: 'Plan comptable', icon: BookOpen, description: 'SYSCOHADA révisé — 8 classes de comptes, recherche instantanée, personnalisation des auxiliaires.' },
      { href: '/accounting-periods', label: 'Périodes', icon: Calendar, description: 'Exercices et périodes — ouverture, clôture, verrouillage automatique des périodes passées.' },
      { href: '/currencies', label: 'Devises', icon: Coins, description: 'Multi-devises — XOF (Franc CFA), EUR, USD avec taux de change et conversion automatique.' },
    ],
    features: [
      'Plan comptable SYSCOHADA complet (classes 1 à 8)',
      'Gestion multi-exercices avec clôtures automatisées',
      'Multi-devises : XOF, EUR, USD et devises personnalisées',
      'Protection des données en périodes verrouillées',
    ],
    tone: 'accent',
    Illustration: ReferentielIllustration,
  },
  {
    id: 'saisie',
    number: '03',
    title: 'Saisie',
    tagline: 'Enregistrement et validation des opérations comptables',
    description:
      'La saisie couvre tout le cycle d\'enregistrement : journaux manuels avec contrôle débit/crédit temps réel, workflow de validation multi-niveaux (Brouillon → Soumis → Validé → Comptabilisé), et imports automatisés depuis Sage, CSV ou PDF avec détection d\'anomalies.',
    items: [
      { href: '/journals', label: 'Journaux', icon: BookText, description: 'Écritures JV, JA, BAN, OD — grille débit/crédit avec contrôle d\'équilibre automatique.' },
      { href: '/entry-workflow', label: 'Workflow écritures', icon: PenLine, description: 'Validation multi-niveaux — Brouillon, Soumis, Validé, Comptabilisé avec piste d\'audit.' },
      { href: '/imports', label: 'Imports', icon: FileUp, description: 'Import Sage (export comptable), CSV, PDF — mapping automatique et détection de doublons.' },
    ],
    features: [
      'Journaux JV, JA, BAN, OD avec vérification débit/crédit',
      'Workflow configurable par journal et par rôle utilisateur',
      'Import Sage, CSV, PDF avec mapping automatique des colonnes',
      'Détection des doublons et anomalies à l\'import',
    ],
    tone: 'neutral',
    Illustration: SaisieIllustration,
  },
  {
    id: 'retraitement',
    number: '04',
    title: 'Retraitement',
    tagline: 'Rapprochements, lettrage et automatisations',
    description:
      'Le retraitement couvre les opérations de régularisation qui représentent typiquement 40 % du temps d\'un comptable OHADA : lettrage des comptes 411/401, rapprochement des relevés bancaires, transformations d\'écritures et règles d\'automatisation configurables sans code.',
    items: [
      { href: '/lettering', label: 'Lettrage', icon: Link2, description: 'Comptes 411/401 — association semi-automatique des factures avec leurs paiements.' },
      { href: '/bank-reconciliation', label: 'Rapprochement bancaire', icon: Banknote, description: 'Relevés vs écritures BAN — écarts identifiés, soldes pointés, lettrage automatique.' },
      { href: '/transformations', label: 'Transformations', icon: ArrowRightLeft, description: 'Reclassement d\'écritures — OD d\'ajustement, régularisations fin de période.' },
      { href: '/rules', label: 'Règles', icon: Sparkles, description: 'Automatisations métier — catégorisation automatique, génération d\'OD récurrentes.' },
    ],
    features: [
      'Lettrage semi-automatique des comptes 411 et 401',
      'Import de relevés bancaires (CSV, OFX)',
      'Transformations par lots avec prévisualisation',
      'Règles métier configurables sans code',
    ],
    tone: 'warn',
    Illustration: RetraitementIllustration,
  },
  {
    id: 'etats',
    number: '05',
    title: 'États financiers',
    tagline: 'Production des états réglementaires OHADA',
    description:
      'Les états financiers génèrent automatiquement les documents réglementaires : Bilan, Compte de résultat, TAFIRE (Tableau de financement), Balance générale. Conformes au Tome 3 SYSCOHADA révisé. La TVA produit les déclarations mensuelles UEMOA pour la DGI.',
    items: [
      { href: '/reports', label: 'États financiers', icon: BarChart3, description: 'Bilan, Compte de résultat, TAFIRE — générés depuis la balance, export PDF.' },
      { href: '/tva', label: 'TVA', icon: Percent, description: 'Déclarations TVA UEMOA — collectée, déductible, net à décaisser, export DGI.' },
      { href: '/inventory', label: 'Inventaire', icon: Warehouse, description: 'États d\'inventaire — valorisation des stocks, mouvements, écarts d\'inventaire.' },
      { href: '/assets', label: 'Immobilisations', icon: Package, description: 'Suivi des immobilisations — amortissements linéaires/dégressifs, tableau de dotation.' },
    ],
    features: [
      'Bilan, Compte de résultat, TAFIRE conformes Tome 3 OHADA',
      'Balance générale et balance âgée avec ruptures',
      'Déclarations TVA UEMOA avec ventilation automatique',
      'Tableau d\'amortissement et fiche individuelle par immobilisation',
    ],
    tone: 'info',
    Illustration: EtatsIllustration,
  },
  {
    id: 'ia',
    number: '06',
    title: 'IA & Automation',
    tagline: 'Détection intelligente des anomalies et automatisation',
    description:
      'Le module IA analyse en continu le grand livre pour détecter les anomalies — doublons, déséquilibres, imputations inhabituelles — avec un score de confiance et des suggestions de correction. Les Workflows automatisent les tâches répétitives et les notifications d\'échéances.',
    items: [
      { href: '/ai', label: 'IA — Anomalies', icon: Brain, description: 'Détection automatique — doublons, imputations inhabituelles avec score de confiance.' },
      { href: '/workflows', label: 'Workflows', icon: GitBranch, description: 'Automatisation — déclencheurs, actions conditionnelles, notifications d\'échéances fiscales.' },
    ],
    features: [
      'Détection de doublons et imputations inhabituelles',
      'Score de confiance sur chaque anomalie signalée',
      'Workflows visuels sans code (déclencheur → condition → action)',
      'Notifications automatiques pour TVA, clôtures, échéances',
    ],
    tone: 'accent',
    Illustration: IAIllustration,
  },
  {
    id: 'organisation',
    number: '07',
    title: 'Organisation',
    tagline: 'Gouvernance, traçabilité et sécurité des accès',
    description:
      'L\'organisation gère les aspects administratifs et de gouvernance : collaboration multi-utilisateurs avec rôles granulaires, stockage des pièces justificatives liées aux écritures, journal d\'audit immuable de toutes les actions, et sécurité renforcée par MFA TOTP.',
    items: [
      { href: '/collaboration', label: 'Collaboration', icon: Handshake, description: 'Travail en équipe — rôles Admin, Comptable, Auditeur avec permissions par module.' },
      { href: '/documents', label: 'Documents', icon: Paperclip, description: 'Pièces justificatives — liées aux écritures, stockage sécurisé, recherche plein texte.' },
      { href: '/audit-logs', label: 'Journal d\'audit', icon: History, description: 'Traçabilité complète — chaque action tracée avec auteur, horodatage et diff avant/après.' },
      { href: '/members', label: 'Membres', icon: Users, description: 'Gestion des utilisateurs — invitations, désactivation, changement de rôle.' },
      { href: '/invitations', label: 'Invitations', icon: Mail, description: 'Invitations email — lien sécurisé à durée limitée, assignation du rôle à l\'inscription.' },
      { href: '/settings/mfa', label: 'Sécurité MFA', icon: ShieldCheck, description: 'Authentification multi-facteurs — TOTP (Authy, Google Authenticator) pour sécuriser les accès.' },
    ],
    features: [
      'Rôles Admin, Comptable, Auditeur avec permissions granulaires',
      'Journal d\'audit immuable (acteur, horodatage, diff)',
      'Pièces justificatives indexées et liées aux écritures',
      'MFA TOTP pour la sécurité des accès',
    ],
    tone: 'neutral',
    Illustration: OrganisationIllustration,
  },
];

export default function WelcomePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px] pb-24">
        <header className="border-b border-line py-12 space-y-6">
          <p className="eyebrow">Documentation interactive</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink sm:text-5xl">
            Bienvenue sur l'ERP Compta OHADA
          </h1>
          <p className="max-w-[68ch] text-base leading-relaxed text-ink-soft">
            Découvrez les 7 modules de votre ERP comptable, conçus pour les entreprises
            de la zone OHADA et conformes au système SYSCOHADA révisé. Chaque module
            s'inscrit dans le flux naturel du travail comptable quotidien.
          </p>
          <nav aria-label="Modules" className="flex flex-wrap gap-2 pt-2">
            {MODULE_GROUPS.map((g) => (
              <a
                key={g.id}
                href={`#${g.id}`}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors duration-fast hover:bg-sunk hover:text-ink"
              >
                <span className="font-mono text-2xs text-ink-mute tabular-nums">{g.number}</span>
                {g.title}
              </a>
            ))}
          </nav>
        </header>

        <div className="divide-y divide-line">
          {MODULE_GROUPS.map((group, i) => (
            <ModuleSection key={group.id} group={group} index={i} />
          ))}
        </div>

        <div className="mt-16 rounded-xl border border-line bg-sunk px-10 py-12 text-center">
          <p className="eyebrow mb-3">Prêt à démarrer</p>
          <h2 className="font-display text-2xl font-medium text-ink">
            Commencez par le tableau de bord
          </h2>
          <p className="mx-auto mt-3 max-w-[50ch] text-sm text-ink-soft">
            Accédez à votre espace de travail principal pour voir l'état du dossier
            et les priorités du jour.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity duration-fast hover:opacity-90"
          >
            Aller au tableau de bord
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

/* ─── Section component ────────────────────────────────────────── */

function ModuleSection({ group, index }: { group: ModuleGroup; index: number }) {
  const isReversed = index % 2 === 1;

  const contentBlock = (
    <div className="space-y-6">
      <div className={`border-l-2 pl-4 ${TONE_BORDER[group.tone]}`}>
        <p className="font-mono text-2xs uppercase tracking-widest text-ink-mute">
          Module {group.number}
        </p>
        <h2 id={group.id} className="mt-1 font-display text-3xl font-medium tracking-tight text-ink">
          {group.title}
        </h2>
      </div>
      <p className="text-sm font-medium text-ink-soft">{group.tagline}</p>
      <p className="max-w-[58ch] text-sm leading-relaxed text-ink-soft">
        {group.description}
      </p>
      <ul className="space-y-2 pt-1">
        {group.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-ink-soft">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-mute" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
      <div className="grid gap-1.5 pt-2">
        {group.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors duration-fast hover:bg-sunk"
          >
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm ${TONE_SOFT_BG[group.tone]}`}>
              <item.icon className="h-3.5 w-3.5" strokeWidth={1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink">{item.label}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-ink-mute">{item.description}</div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 self-center text-ink-mute opacity-0 transition-all duration-fast group-hover:translate-x-0.5 group-hover:opacity-100"
              strokeWidth={1.5}
            />
          </Link>
        ))}
      </div>
    </div>
  );

  const visualBlock = (
    <div className="space-y-4">
      <div
        className="overflow-hidden rounded-xl border border-line shadow-pop"
        aria-hidden="true"
      >
        <group.Illustration />
      </div>
      <VideoCard title={`Tutoriel — ${group.title}`} tone={group.tone} />
    </div>
  );

  return (
    <section className="scroll-mt-8 py-16">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        {isReversed ? (
          <>
            {visualBlock}
            {contentBlock}
          </>
        ) : (
          <>
            {contentBlock}
            {visualBlock}
          </>
        )}
      </div>
    </section>
  );
}

/* ─── Video placeholder ────────────────────────────────────────── */

function VideoCard({ title, tone }: { title: string; tone: Tone }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
      tone === 'info' ? 'border-info/20 bg-info-soft' :
      tone === 'warn' ? 'border-warn/20 bg-warn-soft' :
      tone === 'accent' ? 'border-accent/20 bg-accent-soft' :
      tone === 'critical' ? 'border-critical/20 bg-critical-soft' :
      'border-line bg-sunk'
    }`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${TONE_PLAY_BG[tone]}`}>
        <Play className="h-4 w-4 translate-x-px fill-white text-white" strokeWidth={0} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-2xs text-ink-mute">Tutoriel vidéo · Disponible prochainement</p>
      </div>
    </div>
  );
}

/* ─── Illustrations ────────────────────────────────────────────── */

function PilotageIllustration() {
  return (
    <div className="pointer-events-none select-none bg-paper p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-2.5 w-36 rounded bg-sunk" />
        <div className="h-2.5 w-16 rounded bg-accent-soft" />
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2.5">
        <div className="rounded-md bg-sunk p-3">
          <div className="mb-1.5 h-1.5 w-12 rounded bg-line-strong" />
          <div className="font-display text-2xl font-medium text-ink">A−</div>
          <div className="mt-1 h-1.5 w-14 rounded bg-line" />
        </div>
        <div className="rounded-md bg-sunk p-3">
          <div className="mb-1.5 h-1.5 w-12 rounded bg-line-strong" />
          <div className="font-mono text-lg font-medium tabular-nums text-ink">1 247</div>
          <div className="mt-1 h-1.5 w-10 rounded bg-line" />
        </div>
        <div className="rounded-md bg-critical-soft p-3">
          <div className="mb-1.5 h-1.5 w-12 rounded bg-critical/30" />
          <div className="text-sm font-medium text-critical-ink">15 mai</div>
          <div className="mt-1 h-1.5 w-14 rounded bg-critical/20" />
        </div>
      </div>
      <div className="rounded-md bg-sunk p-3">
        <div className="mb-3 h-1.5 w-32 rounded bg-line-strong" />
        <div className="flex h-20 items-end gap-1">
          {[52, 65, 42, 78, 58, 88, 70, 95, 62, 85, 72, 100].map((h, i) => (
            <div
              key={i}
              className={`flex-1 rounded-sm ${i === 11 ? 'bg-accent' : 'bg-line-strong'}`}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 rounded bg-info-soft px-2 py-1.5">
          <div className="h-4 w-4 rounded-sm bg-info/40" />
          <div className="h-1.5 flex-1 rounded bg-info/30" />
          <div className="h-1.5 w-5 rounded bg-info/50" />
        </div>
        <div className="flex items-center gap-2 rounded bg-warn-soft px-2 py-1.5">
          <div className="h-4 w-4 rounded-sm bg-warn/40" />
          <div className="h-1.5 flex-1 rounded bg-warn/30" />
          <div className="h-1.5 w-4 rounded bg-warn/50" />
        </div>
      </div>
    </div>
  );
}

function ReferentielIllustration() {
  const classes = [
    { code: '1', label: 'Comptes de capitaux', sub: ['11 — Capital', '13 — Réserves', '17 — Emprunts'] },
    { code: '4', label: 'Comptes de tiers', sub: ['411 — Clients', '401 — Fournisseurs', '421 — Personnel'] },
    { code: '7', label: 'Comptes de produits', sub: ['701 — Ventes marchandises', '706 — Services vendus'] },
  ];
  return (
    <div className="pointer-events-none select-none bg-paper p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-2.5 w-40 rounded bg-sunk" />
        <div className="h-2.5 w-20 rounded bg-accent-soft" />
      </div>
      <div className="space-y-2">
        {classes.map((cls) => (
          <div key={cls.code}>
            <div className="flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2">
              <span className="font-mono text-xs font-medium text-accent-ink tabular-nums">{cls.code}</span>
              <span className="text-xs font-medium text-accent-ink">{cls.label}</span>
            </div>
            <div className="ml-5 mt-1 space-y-0.5 border-l border-line pl-3">
              {cls.sub.map((s) => (
                <div key={s} className="flex items-center gap-2 rounded px-2 py-1">
                  <span className="font-mono text-2xs text-ink-mute">{s.split(' — ')[0]}</span>
                  <span className="text-xs text-ink-soft">{s.split(' — ')[1]}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SaisieIllustration() {
  const entries = [
    { account: '411000', label: 'Client Akila SA', debit: '1 250 000', credit: '' },
    { account: '706000', label: 'Produits vendus', debit: '', credit: '1 046 218' },
    { account: '443110', label: 'TVA collectée 18%', debit: '', credit: '203 782' },
  ];
  return (
    <div className="pointer-events-none select-none bg-paper p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="rounded-sm bg-sunk px-2 py-1">
          <span className="font-mono text-xs font-medium text-ink-soft">JV-2026-05-027</span>
        </div>
        <div className="h-2 flex-1 rounded bg-sunk" />
        <div className="rounded-full bg-accent-soft px-2 py-0.5">
          <span className="text-2xs font-medium text-accent-ink">Validé ✓</span>
        </div>
      </div>
      <div className="mb-1.5 grid grid-cols-[2fr_3fr_2fr_2fr] gap-1 px-2 text-2xs font-medium uppercase tracking-wider text-ink-mute">
        <span>Compte</span><span>Libellé</span>
        <span className="text-right">Débit</span><span className="text-right">Crédit</span>
      </div>
      <div className="divide-y divide-line rounded-md border border-line">
        {entries.map((e, i) => (
          <div key={i} className="grid grid-cols-[2fr_3fr_2fr_2fr] gap-1 px-2 py-1.5">
            <span className="font-mono text-xs text-ink-soft">{e.account}</span>
            <span className="truncate text-xs text-ink">{e.label}</span>
            <span className="text-right font-mono text-xs tabular-nums text-ink">{e.debit}</span>
            <span className="text-right font-mono text-xs tabular-nums text-ink">{e.credit}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between rounded-md bg-accent-soft px-3 py-2">
        <span className="text-xs font-medium text-accent-ink">Total</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-medium tabular-nums text-accent-ink">1 250 000</span>
          <span className="text-xs text-accent-ink">=</span>
          <span className="font-mono text-xs font-medium tabular-nums text-accent-ink">1 250 000</span>
          <span className="text-xs font-bold text-accent-ink">✓</span>
        </div>
      </div>
    </div>
  );
}

function RetraitementIllustration() {
  return (
    <div className="pointer-events-none select-none bg-paper p-5">
      <div className="mb-4 h-2.5 w-44 rounded bg-sunk" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-ink-mute">Factures</div>
          <div className="space-y-1.5">
            {[
              { ref: 'FAC-2026-041', amount: '850 000', matched: true },
              { ref: 'FAC-2026-042', amount: '420 000', matched: true },
              { ref: 'FAC-2026-043', amount: '310 000', matched: false },
            ].map((f) => (
              <div key={f.ref} className={`rounded-md border px-2.5 py-2 ${f.matched ? 'border-accent/30 bg-accent-soft' : 'border-line bg-sunk'}`}>
                <div className="font-mono text-2xs text-ink-mute">{f.ref}</div>
                <div className="font-mono text-xs font-medium tabular-nums text-ink">{f.amount} XOF</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-ink-mute">Paiements</div>
          <div className="space-y-1.5">
            {[
              { ref: 'VIR-045', amount: '850 000', matched: true },
              { ref: 'CHQ-012', amount: '420 000', matched: true },
              { ref: '—', amount: 'En attente', matched: false },
            ].map((p, i) => (
              <div key={i} className={`rounded-md border px-2.5 py-2 ${p.matched ? 'border-accent/30 bg-accent-soft' : 'border-dashed border-line bg-paper'}`}>
                <div className="font-mono text-2xs text-ink-mute">{p.ref}</div>
                <div className={`text-xs ${p.matched ? 'font-mono font-medium tabular-nums text-ink' : 'italic text-ink-mute'}`}>{p.amount}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-md bg-sunk px-3 py-2">
        <span className="text-xs text-ink-soft">Lettrage compte 411</span>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
            <div className="h-full w-2/3 rounded-full bg-accent" />
          </div>
          <span className="font-mono text-xs text-ink-soft">66%</span>
        </div>
      </div>
    </div>
  );
}

function EtatsIllustration() {
  return (
    <div className="pointer-events-none select-none bg-paper p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs font-medium text-ink">BILAN — Exercice 2025</span>
        <div className="rounded-sm bg-info-soft px-2 py-0.5">
          <span className="text-2xs text-info-ink">SYSCOHADA</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-mute">Actif</div>
          <div className="space-y-0.5">
            {[
              { label: 'Actif immobilisé', value: '4 200 000' },
              { label: 'Actif circulant', value: '12 750 000' },
              { label: 'Trésorerie active', value: '2 480 000' },
            ].map((r) => (
              <div key={r.label} className="flex justify-between rounded px-2 py-1.5 text-xs">
                <span className="text-ink-soft">{r.label}</span>
                <span className="font-mono tabular-nums text-ink">{r.value}</span>
              </div>
            ))}
            <div className="flex justify-between rounded-md bg-info-soft px-2 py-1.5 text-xs font-semibold">
              <span className="text-info-ink">Total Actif</span>
              <span className="font-mono tabular-nums text-info-ink">19 430 000</span>
            </div>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-mute">Passif</div>
          <div className="space-y-0.5">
            {[
              { label: 'Capitaux propres', value: '8 100 000' },
              { label: 'Dettes à long terme', value: '4 850 000' },
              { label: 'Dettes court terme', value: '6 480 000' },
            ].map((r) => (
              <div key={r.label} className="flex justify-between rounded px-2 py-1.5 text-xs">
                <span className="text-ink-soft">{r.label}</span>
                <span className="font-mono tabular-nums text-ink">{r.value}</span>
              </div>
            ))}
            <div className="flex justify-between rounded-md bg-info-soft px-2 py-1.5 text-xs font-semibold">
              <span className="text-info-ink">Total Passif</span>
              <span className="font-mono tabular-nums text-info-ink">19 430 000</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IAIllustration() {
  return (
    <div className="pointer-events-none select-none bg-paper p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft">
          <Brain className="h-3 w-3 text-accent-ink" strokeWidth={1.5} />
        </span>
        <span className="text-sm font-medium text-ink">Analyse du grand livre</span>
        <div className="ml-auto rounded-full bg-accent-soft px-2 py-0.5">
          <span className="text-2xs text-accent-ink">En cours…</span>
        </div>
      </div>
      <div className="space-y-2">
        <div className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2.5">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-critical/25 text-2xs font-bold text-critical-ink">!</div>
            <div className="flex-1">
              <div className="text-xs font-medium text-critical-ink">Doublon potentiel détecté</div>
              <div className="mt-0.5 text-2xs text-critical-ink/70">JV-2026-04-018 · JV-2026-04-031 — Montants identiques, même date</div>
            </div>
            <div className="rounded-sm bg-critical/20 px-1 py-0.5 text-2xs font-medium text-critical-ink">94%</div>
          </div>
        </div>
        <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2.5">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-warn/25 text-2xs font-bold text-warn-ink">?</div>
            <div className="flex-1">
              <div className="text-xs font-medium text-warn-ink">Imputation inhabituelle</div>
              <div className="mt-0.5 text-2xs text-warn-ink/70">Compte 6112 — Dépassement ×3 de la moyenne mensuelle</div>
            </div>
            <div className="rounded-sm bg-warn/20 px-1 py-0.5 text-2xs font-medium text-warn-ink">72%</div>
          </div>
        </div>
        <div className="rounded-md border border-line bg-sunk px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-sm bg-line-strong" />
            <div className="h-1.5 flex-1 rounded bg-line-strong" />
            <div className="rounded-sm bg-line px-1 py-0.5 text-2xs text-ink-mute">42%</div>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-sunk p-2">
          <div className="font-mono text-xl font-medium tabular-nums text-ink">3</div>
          <div className="text-2xs text-ink-mute">Anomalies</div>
        </div>
        <div className="rounded-md bg-sunk p-2">
          <div className="font-mono text-xl font-medium tabular-nums text-ink">1 247</div>
          <div className="text-2xs text-ink-mute">Analysées</div>
        </div>
        <div className="rounded-md bg-accent-soft p-2">
          <div className="font-mono text-xl font-medium tabular-nums text-accent-ink">99.8%</div>
          <div className="text-2xs text-accent-ink">Score IA</div>
        </div>
      </div>
    </div>
  );
}

function OrganisationIllustration() {
  const members = [
    { initials: 'AK', name: 'Awa Koffi', role: 'Admin', online: true },
    { initials: 'KY', name: 'Kouamé Yao', role: 'Comptable', online: true },
    { initials: 'MA', name: 'Marie Assi', role: 'Auditeur', online: false },
  ];
  return (
    <div className="pointer-events-none select-none bg-paper p-5">
      <div className="mb-3 h-2.5 w-32 rounded bg-sunk" />
      <div className="mb-4 space-y-2">
        {members.map((m) => (
          <div key={m.name} className="flex items-center gap-3 rounded-md border border-line bg-paper px-3 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunk font-mono text-xs font-medium text-ink-soft">
              {m.initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-ink">{m.name}</div>
              <div className="text-2xs text-ink-mute">{m.role}</div>
            </div>
            <div className={`h-2 w-2 rounded-full ${m.online ? 'bg-accent' : 'bg-line-strong'}`} />
          </div>
        ))}
      </div>
      <div className="rounded-md bg-sunk p-3">
        <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-ink-mute">Journal d'audit</div>
        <div className="space-y-2">
          {[
            { actor: 'Awa Koffi', action: 'a validé', target: 'JV-2026-05-027', time: 'il y a 3 min' },
            { actor: 'Kouamé Yao', action: 'a lettré', target: 'compte 411-AKILA', time: 'il y a 1 h' },
          ].map((log, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-mute" />
              <div>
                <span className="text-2xs font-medium text-ink">{log.actor}</span>
                <span className="text-2xs text-ink-soft"> {log.action} </span>
                <span className="text-2xs font-medium text-ink">{log.target}</span>
                <div className="text-2xs text-ink-mute">{log.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
