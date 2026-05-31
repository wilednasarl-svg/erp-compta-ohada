'use client';

import { BookOpen, ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Encart pédagogique « Comprendre ce rapport » affiché SOUS un état
 * financier. Donne le contexte de lecture (à quoi sert l'état, la règle
 * d'équilibre, comment interpréter les écarts) — direction « papier
 * ivoire » de DESIGN.md, ton sobre et didactique.
 *
 * Net-new, sans dépendance au reste de la page : se branche en une ligne
 * `<ReportHelp topic="bilan" />` sous le rapport voulu.
 */
export type ReportHelpTopic = 'balance' | 'bilan' | 'compte-resultat';

interface HelpBlock {
  readonly term: string;
  readonly def: string;
}

interface HelpContent {
  readonly title: string;
  readonly intro: string;
  readonly rule: string;
  readonly blocks: readonly HelpBlock[];
}

const HELP: Record<ReportHelpTopic, HelpContent> = {
  balance: {
    title: 'Comprendre la Balance générale',
    intro:
      'La balance est la liste de tous tes comptes avec leur solde. C’est la matière première de tous les états financiers : le Bilan et le Compte de résultat en sont dérivés.',
    rule:
      'Règle d’équilibre : Σ Soldes débiteurs = Σ Soldes créditeurs. Toute écriture comptable porte un débit ÉGAL à un crédit — une balance correcte est donc toujours équilibrée. Un déséquilibre signale un problème d’import ou de saisie, jamais une fatalité comptable.',
    blocks: [
      {
        term: 'Solde débiteur / créditeur',
        def: 'Pour chaque compte, la différence entre ses débits et ses crédits cumulés. Les comptes d’emplois (actif, charges) sont généralement débiteurs ; les comptes de ressources (passif, produits) créditeurs.',
      },
      {
        term: 'Après inventaire',
        def: 'Tous les travaux de clôture sont passés (amortissements 28x, dépréciations, régularisations, provisions, variations de stocks). Seule une balance après inventaire permet des états CERTIFIABLES.',
      },
      {
        term: 'Avant inventaire',
        def: 'Les écritures de clôture ne sont pas encore passées : les états générés sont provisoires, à n’utiliser que pour une simulation ou un point intermédiaire.',
      },
    ],
  },
  bilan: {
    title: 'Comprendre le Bilan',
    intro:
      'Le Bilan est la photographie du patrimoine à une date. À gauche l’ACTIF (les emplois : ce que tu possèdes et ce qu’on te doit) ; à droite le PASSIF (les ressources : d’où vient le financement).',
    rule:
      'Règle d’or : Total Actif = Total Passif. Chaque emploi a une ressource qui le finance. Si l’écart n’est pas nul, trois causes possibles : (1) la balance source n’est pas équilibrée, (2) le résultat de l’exercice n’a pas été incorporé, (3) des comptes sont mal classés.',
    blocks: [
      {
        term: 'Actif : Brut / Amortissements / Net',
        def: 'Le Brut est la valeur d’origine d’un bien ; les Amortissements & dépréciations cumulent son usure ; le Net (Brut − Amort.) est la valeur résiduelle réellement portée au bilan.',
      },
      {
        term: 'Incorporer le résultat',
        def: 'Le résultat de l’exercice (Produits − Charges) rejoint les capitaux propres au passif (poste CJ). C’est lui qui « ferme » le bilan : un bénéfice augmente les ressources, une perte les diminue.',
      },
      {
        term: 'Ressources stables vs Passif circulant',
        def: 'Les ressources stables (capitaux propres + dettes financières) financent le long terme ; le passif circulant (fournisseurs, dettes fiscales et sociales) correspond au court terme.',
      },
    ],
  },
  'compte-resultat': {
    title: 'Comprendre le Compte de résultat',
    intro:
      'Le Compte de résultat mesure la PERFORMANCE sur une période (et non un patrimoine à une date). Il oppose ce que l’entreprise a gagné à ce qu’elle a dépensé.',
    rule:
      'Règle : Produits (classe 7) − Charges (classe 6) = Résultat net. Positif → bénéfice ; négatif → perte. Ce résultat est ensuite reporté au passif du Bilan, ce qui relie les deux états.',
    blocks: [
      {
        term: 'Soldes intermédiaires de gestion',
        def: 'SYSCOHADA décompose la formation du résultat : marge commerciale, valeur ajoutée, excédent brut d’exploitation (EBE), résultat d’exploitation, financier, puis net. Ils montrent OÙ se crée (ou se détruit) la valeur.',
      },
      {
        term: 'Variations de stocks',
        def: 'Les comptes 603x / 73x ajustent les charges et produits de la variation des stocks sur la période : un déstockage augmente le coût des ventes, un stockage le diminue.',
      },
    ],
  },
};

export function ReportHelp({ topic, className }: { readonly topic: ReportHelpTopic; readonly className?: string }) {
  const [open, setOpen] = useState(false);
  const content = HELP[topic];

  return (
    <section
      className={cn(
        'no-print mt-4 rounded-md border border-line bg-sunk/30 text-ink',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-sunk/50"
      >
        <BookOpen className="h-4 w-4 shrink-0 text-accent-ink" strokeWidth={1.5} aria-hidden />
        <span>{content.title}</span>
        <ChevronDown
          className={cn('ml-auto h-4 w-4 shrink-0 text-ink-mute transition-transform', open && 'rotate-180')}
          strokeWidth={1.5}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-4 py-4 text-sm leading-relaxed">
          <p className="text-ink-soft">{content.intro}</p>
          <p className="rounded-sm border border-accent/25 bg-accent-soft/40 px-3 py-2 text-accent-ink">
            {content.rule}
          </p>
          <dl className="space-y-2">
            {content.blocks.map((b) => (
              <div key={b.term}>
                <dt className="font-medium text-ink">{b.term}</dt>
                <dd className="text-ink-mute">{b.def}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
