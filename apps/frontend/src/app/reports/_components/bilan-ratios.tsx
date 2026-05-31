'use client';

import { AlertTriangle, BarChart3, CheckCircle2, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { BalanceSheetReport, BilanMasse } from '@/types/reports';

/**
 * Section « Ratios & analyse » affichée sous le Bilan. Calcule les
 * indicateurs financiers usuels SYSCOHADA (structure, équilibre FR/BFR/TN,
 * liquidité, solvabilité) à partir des MASSES du bilan, et fournit pour
 * chaque ratio le DÉTAIL chiffré du calcul + une INTERPRÉTATION dérivée de sa
 * valeur réelle, plus des observations de synthèse. Purement dérivé du rapport.
 */

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const fcfa = (n: number): string => nf0.format(Math.round(n));
const pct = (n: number): string => (Number.isFinite(n) ? `${(n * 100).toFixed(1)} %` : '—');
const mult = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : '—');

function masseTotal(masses: ReadonlyArray<BilanMasse>, code: string): number {
  return Number(masses.find((m) => m.code === code)?.total ?? 0);
}

function posteNet(masses: ReadonlyArray<BilanMasse>, code: string): number {
  for (const m of masses) {
    for (const r of m.rubriques) {
      for (const p of r.postes) {
        if (p.code === code) return Number(p.net);
      }
    }
  }
  return 0;
}

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-accent',
  warn: 'bg-[oklch(0.72_0.15_75)]',
  bad: 'bg-critical',
  neutral: 'bg-line-strong',
};

interface RatioRow {
  readonly label: string;
  readonly formula: string;
  /** Calcul en valeurs réelles, ex. « 2 379 440 794 / 19 438 844 737 ». */
  readonly detail: string;
  readonly value: string;
  readonly tone: Tone;
  readonly interpretation: string;
}

export function BilanRatios({ report }: { readonly report: BalanceSheetReport }) {
  const A = report.actifMasses;
  const P = report.passifMasses;

  const immobilise = masseTotal(A, 'AZ');
  const circulant = masseTotal(A, 'BK');
  const tresoA = masseTotal(A, 'BT');
  const creances = masseTotal(A, 'BG');
  const totalActif = Number(report.totals.actif);

  const cp = masseTotal(P, 'CP');
  const stables = masseTotal(P, 'DF');
  const passifCirc = masseTotal(P, 'DP');
  const tresoP = masseTotal(P, 'DT');
  const totalPassif = Number(report.totals.passif);
  const totalDettes = totalPassif - cp;
  const autresDettes = posteNet(P, 'DM');

  const equilibre = Math.abs(Number(report.totals.difference)) < 1;
  const div = (a: number, b: number): number => (b !== 0 ? a / b : NaN);
  const ratioOf = (a: number, b: number): string => `${fcfa(a)} / ${fcfa(b)}`;
  const diffOf = (a: number, b: number): string => `${fcfa(a)} − ${fcfa(b)}`;

  const autonomie = div(cp, totalPassif);
  const endettement = div(totalDettes, cp);
  const couverture = div(stables, immobilise);
  const fr = stables - immobilise;
  const bfr = circulant - passifCirc;
  const tn = tresoA - tresoP;
  const liqGen = div(circulant + tresoA, passifCirc + tresoP);
  const liqRed = div(creances + tresoA, passifCirc);
  const liqImm = div(tresoA, passifCirc);
  const solva = div(totalActif, totalDettes);

  const rows: ReadonlyArray<RatioRow> = [
    {
      label: 'Autonomie financière',
      formula: 'Capitaux propres / Total passif',
      detail: ratioOf(cp, totalPassif),
      value: pct(autonomie),
      tone: autonomie >= 0.3 ? 'ok' : autonomie >= 0.2 ? 'warn' : 'bad',
      interpretation:
        autonomie >= 0.3
          ? `Bonne capitalisation : ${pct(autonomie)} du bilan est financé par les fonds propres — structure solide face aux aléas.`
          : autonomie >= 0.2
            ? `Capitalisation correcte mais à renforcer (${pct(autonomie)}) : la marge de sécurité reste limitée.`
            : `Structure très dépendante des dettes (seulement ${pct(autonomie)} de fonds propres). Vérifiez si des comptes courants d'associés peuvent être assimilés à des quasi-fonds propres avant de conclure à une fragilité.`,
    },
    {
      label: 'Endettement',
      formula: 'Total dettes / Capitaux propres',
      detail: ratioOf(totalDettes, cp),
      value: mult(endettement),
      tone: endettement <= 1 ? 'ok' : endettement <= 2 ? 'warn' : 'bad',
      interpretation:
        endettement <= 1
          ? `Endettement maîtrisé : les dettes restent au niveau des fonds propres ou en deçà.`
          : endettement <= 2
            ? `Endettement élevé : les dettes valent ${mult(endettement)} fois les fonds propres — à surveiller.`
            : `Très endettée : les dettes pèsent ${mult(endettement)} fois les fonds propres ; capacité d'emprunt quasi saturée.`,
    },
    {
      label: 'Couverture des emplois stables',
      formula: 'Ressources stables / Actif immobilisé',
      detail: ratioOf(stables, immobilise),
      value: mult(couverture),
      tone: couverture >= 1 ? 'ok' : 'bad',
      interpretation:
        couverture >= 1
          ? `Sain : l'immobilisé est intégralement financé par des ressources durables, avec un excédent dégagé pour l'exploitation.`
          : `Déséquilibre : une partie des immobilisations est financée à court terme — risque de tension de trésorerie.`,
    },
    {
      label: 'Fonds de roulement (FR)',
      formula: 'Ressources stables − Actif immobilisé',
      detail: diffOf(stables, immobilise),
      value: fcfa(fr),
      tone: fr >= 0 ? 'ok' : 'bad',
      interpretation:
        fr >= 0
          ? `Positif (${fcfa(fr)} FCFA) : les ressources stables couvrent l'immobilisé et laissent une marge pour financer le cycle d'exploitation.`
          : `Négatif (${fcfa(fr)} FCFA) : l'immobilisé n'est pas couvert par des ressources durables — équilibre financier fragile.`,
    },
    {
      label: 'Besoin en fonds de roulement (BFR)',
      formula: 'Actif circulant − Passif circulant',
      detail: diffOf(circulant, passifCirc),
      value: fcfa(bfr),
      tone: 'neutral',
      interpretation:
        bfr > 0
          ? `Positif (${fcfa(bfr)} FCFA) : l'exploitation consomme de la trésorerie (créances + stocks > dettes courantes) ; ce besoin doit être financé par le FR.`
          : bfr < 0
            ? `Négatif (${fcfa(bfr)} FCFA) : l'exploitation dégage de la trésorerie — les dettes courantes financent le cycle.`
            : `Quasi nul : le cycle d'exploitation s'autofinance.`,
    },
    {
      label: 'Trésorerie nette',
      formula: 'Trésorerie actif − Trésorerie passif',
      detail: diffOf(tresoA, tresoP),
      value: fcfa(tn),
      tone: tn >= 0 ? 'ok' : 'bad',
      interpretation:
        tn >= 0
          ? `Excédentaire (${fcfa(tn)} FCFA) : le fonds de roulement couvre le BFR, aucun découvert structurel.`
          : `Négative (${fcfa(tn)} FCFA) : l'entreprise dépend de financements court terme (découverts) pour boucler son cycle.`,
    },
    {
      label: 'Liquidité générale',
      formula: '(Actif circulant + Trésorerie) / (Passif circulant + Trésorerie passif)',
      detail: ratioOf(circulant + tresoA, passifCirc + tresoP),
      value: mult(liqGen),
      tone: liqGen >= 1.2 ? 'ok' : liqGen >= 1 ? 'warn' : 'bad',
      interpretation:
        liqGen >= 1.2
          ? `Confortable : l'actif circulant couvre largement les dettes à court terme.`
          : liqGen >= 1
            ? `Juste suffisante (${mult(liqGen)}) : l'actif circulant couvre tout juste le court terme, sans marge.`
            : `Insuffisante (${mult(liqGen)}) : l'actif circulant ne couvre pas les dettes à court terme.`,
    },
    {
      label: 'Liquidité réduite',
      formula: '(Créances + Trésorerie) / Passif circulant',
      detail: ratioOf(creances + tresoA, passifCirc),
      value: mult(liqRed),
      tone: liqRed >= 1 ? 'ok' : liqRed >= 0.8 ? 'warn' : 'bad',
      interpretation:
        liqRed >= 1
          ? `Solide : même sans écouler les stocks, l'entreprise couvre ses dettes à court terme.`
          : liqRed >= 0.8
            ? `Tension (${mult(liqRed)}) : hors stocks, la couverture dépend directement de l'encaissement des créances clients.`
            : `Risque (${mult(liqRed)}) : hors stocks, l'actif « rapide » ne couvre pas les dettes à court terme.`,
    },
    {
      label: 'Liquidité immédiate',
      formula: 'Trésorerie / Passif circulant',
      detail: ratioOf(tresoA, passifCirc),
      value: mult(liqImm),
      tone: liqImm >= 0.2 ? 'ok' : 'neutral',
      interpretation:
        liqImm >= 0.2
          ? `La trésorerie disponible couvre ${pct(liqImm)} des dettes à court terme — coussin de sécurité appréciable.`
          : `Cash immédiat faible (${pct(liqImm)}), fréquent pour une activité à fort BFR : la liquidité repose sur l'encaissement des clients, pas sur la trésorerie en caisse.`,
    },
    {
      label: 'Solvabilité générale',
      formula: 'Total actif / Total dettes',
      detail: ratioOf(totalActif, totalDettes),
      value: mult(solva),
      tone: solva >= 1.5 ? 'ok' : solva >= 1.1 ? 'warn' : 'bad',
      interpretation:
        solva >= 1.5
          ? `Bonne : l'actif représente ${mult(solva)}× les dettes — capacité de remboursement confortable en cas de liquidation.`
          : solva >= 1.1
            ? `Limitée (${mult(solva)}) : l'actif ne dépasse les dettes que de peu — marge de sécurité mince.`
            : `Fragile (${mult(solva)}) : l'actif couvre à peine l'ensemble des dettes.`,
    },
  ];

  // ── Observations de synthèse ─────────────────────────────────────────
  const obs: Array<{ tone: Tone; text: string }> = [];

  if (!equilibre) {
    obs.push({
      tone: 'bad',
      text: 'Bilan non équilibré (Actif ≠ Passif) : les ratios ci-dessus sont indicatifs tant que l’écart n’est pas corrigé.',
    });
  }

  const partAutresDettes = totalPassif > 0 ? autresDettes / totalPassif : 0;
  if (partAutresDettes >= 0.15) {
    const cpRetraite = totalPassif > 0 ? (cp + autresDettes) / totalPassif : NaN;
    obs.push({
      tone: 'warn',
      text: `Les « Autres dettes » pèsent ${pct(partAutresDettes)} du passif (${fcfa(autresDettes)} FCFA). Si ce sont des comptes courants d’associés, retraitez-les en quasi-fonds propres : l’autonomie financière passerait alors à ≈ ${pct(cpRetraite)}.`,
    });
  }

  const partCreances = totalActif > 0 ? creances / totalActif : 0;
  if (partCreances >= 0.5) {
    obs.push({
      tone: 'bad',
      text: `Les créances représentent ${pct(partCreances)} de l’actif (${fcfa(creances)} FCFA). La trésorerie dépend directement du recouvrement clients — point de vigilance prioritaire (relances, provisions, affacturage).`,
    });
  }

  if (Number.isFinite(autonomie) && autonomie < 0.2 && partAutresDettes < 0.15) {
    obs.push({
      tone: 'warn',
      text: `Structure peu capitalisée (autonomie ${pct(autonomie)}) : l’activité repose largement sur les dettes.`,
    });
  }

  obs.push(
    fr >= 0
      ? { tone: 'ok', text: `Fonds de roulement positif (${fcfa(fr)} FCFA) : l’actif immobilisé est financé par des ressources stables.` }
      : { tone: 'bad', text: `Fonds de roulement négatif (${fcfa(fr)} FCFA) : une partie de l’immobilisé est financée à court terme — risque d’équilibre.` },
  );

  obs.push(
    tn >= 0
      ? { tone: 'ok', text: `Trésorerie nette positive (${fcfa(tn)} FCFA).` }
      : { tone: 'bad', text: `Trésorerie nette négative (${fcfa(tn)} FCFA) : dépendance à des financements court terme.` },
  );

  if (Number.isFinite(liqRed) && liqRed < 1) {
    obs.push({
      tone: 'warn',
      text: `Liquidité réduite < 1 (${mult(liqRed)}) : hors stocks, l’actif rapide ne couvre pas tout à fait les dettes court terme.`,
    });
  }

  return (
    <section className="mt-6 rounded-md border border-line bg-paper">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <BarChart3 className="h-4 w-4 shrink-0 text-accent-ink" strokeWidth={1.5} aria-hidden />
        <h3 className="font-display text-base font-medium text-ink">Ratios &amp; analyse</h3>
        <span className="ml-auto text-2xs text-ink-mute">calculés sur les masses du bilan</span>
      </header>

      <ul className="divide-y divide-line/60">
        {rows.map((r) => (
          <li key={r.label} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[r.tone])} aria-hidden />
                <span className="font-medium text-ink">{r.label}</span>
              </div>
              <span className="font-mono text-sm font-semibold tabular-nums text-ink">{r.value}</span>
            </div>
            <p className="mt-0.5 pl-3.5 text-2xs text-ink-mute">{r.formula}</p>
            <p className="mt-0.5 pl-3.5 font-mono text-2xs tabular-nums text-ink-soft">= {r.detail}</p>
            <p className="mt-1 pl-3.5 text-xs leading-relaxed text-ink-soft">{r.interpretation}</p>
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-4 py-3">
        <p className="mb-2 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-ink-mute">
          <AlertTriangle className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Synthèse
        </p>
        <ul className="space-y-1.5">
          {obs.map((o) => (
            <li key={o.text} className="flex gap-2 text-xs text-ink-soft">
              {o.tone === 'ok' ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-ink" strokeWidth={1.5} aria-hidden />
              ) : (
                <TriangleAlert
                  className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', o.tone === 'bad' ? 'text-critical-ink' : 'text-[oklch(0.55_0.13_75)]')}
                  strokeWidth={1.5}
                  aria-hidden
                />
              )}
              <span>{o.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
