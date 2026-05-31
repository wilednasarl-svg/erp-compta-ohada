'use client';

import { AlertTriangle, BarChart3, CheckCircle2, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { BalanceSheetReport, BilanMasse } from '@/types/reports';

/**
 * Section « Ratios & analyse » affichée sous le Bilan. Calcule les
 * indicateurs financiers usuels SYSCOHADA (structure, équilibre FR/BFR/TN,
 * liquidité, solvabilité) à partir des MASSES du bilan, et génère des
 * observations dynamiques selon les seuils. Purement dérivé du rapport —
 * aucun appel réseau.
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
  readonly value: string;
  readonly tone: Tone;
  readonly note: string;
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
  const dettesFin = masseTotal(P, 'DD');
  const stables = masseTotal(P, 'DF');
  const passifCirc = masseTotal(P, 'DP');
  const tresoP = masseTotal(P, 'DT');
  const totalPassif = Number(report.totals.passif);
  const totalDettes = totalPassif - cp;
  const autresDettes = posteNet(P, 'DM');

  const equilibre = Math.abs(Number(report.totals.difference)) < 1;
  const div = (a: number, b: number): number => (b !== 0 ? a / b : NaN);

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
      value: pct(autonomie),
      tone: autonomie >= 0.3 ? 'ok' : autonomie >= 0.2 ? 'warn' : 'bad',
      note: 'Part du bilan financée par les fonds propres (norme > 20–30 %).',
    },
    {
      label: 'Endettement',
      formula: 'Dettes / Capitaux propres',
      value: mult(endettement),
      tone: endettement <= 1 ? 'ok' : endettement <= 2 ? 'warn' : 'bad',
      note: 'Poids des dettes rapporté aux fonds propres (norme < 1–2).',
    },
    {
      label: 'Couverture des emplois stables',
      formula: 'Ressources stables / Actif immobilisé',
      value: mult(couverture),
      tone: couverture >= 1 ? 'ok' : 'bad',
      note: 'L’immobilisé doit être financé par des ressources stables (> 1).',
    },
    {
      label: 'Fonds de roulement (FR)',
      formula: 'Ressources stables − Actif immobilisé',
      value: fcfa(fr),
      tone: fr >= 0 ? 'ok' : 'bad',
      note: 'Marge de sécurité finançant le cycle d’exploitation.',
    },
    {
      label: "Besoin en fonds de roulement (BFR)",
      formula: 'Actif circulant − Passif circulant',
      value: fcfa(bfr),
      tone: 'neutral',
      note: 'Financement requis par l’exploitation (stocks + créances − dettes).',
    },
    {
      label: 'Trésorerie nette',
      formula: 'FR − BFR',
      value: fcfa(tn),
      tone: tn >= 0 ? 'ok' : 'bad',
      note: 'Positive = trésorerie excédentaire ; négative = découvert structurel.',
    },
    {
      label: 'Liquidité générale',
      formula: 'Actif circulant / Passif circulant',
      value: mult(liqGen),
      tone: liqGen >= 1.2 ? 'ok' : liqGen >= 1 ? 'warn' : 'bad',
      note: 'Capacité à honorer le court terme avec l’actif circulant (> 1).',
    },
    {
      label: 'Liquidité réduite',
      formula: '(Créances + Trésorerie) / Passif circulant',
      value: mult(liqRed),
      tone: liqRed >= 1 ? 'ok' : liqRed >= 0.8 ? 'warn' : 'bad',
      note: 'Idem hors stocks — mesure la dépendance à l’encaissement clients.',
    },
    {
      label: 'Liquidité immédiate',
      formula: 'Trésorerie / Passif circulant',
      value: mult(liqImm),
      tone: liqImm >= 0.2 ? 'ok' : 'neutral',
      note: 'Part des dettes court terme couverte par la trésorerie disponible.',
    },
    {
      label: 'Solvabilité générale',
      formula: 'Total actif / Total dettes',
      value: mult(solva),
      tone: solva >= 1.5 ? 'ok' : solva >= 1.1 ? 'warn' : 'bad',
      note: 'Capacité à rembourser l’ensemble des dettes en cas de liquidation.',
    },
  ];

  // ── Observations dynamiques ──────────────────────────────────────────
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
      text: `Les créances représentent ${pct(partCreances)} de l’actif (${fcfa(creances)} FCFA). La santé de la trésorerie dépend directement du recouvrement clients — point de vigilance prioritaire (relances, provisions, affacturage).`,
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

      <div className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-2xs uppercase tracking-wide text-ink-mute">
              <th className="px-4 py-2 text-left font-medium">Indicateur</th>
              <th className="px-3 py-2 text-left font-medium">Formule</th>
              <th className="px-4 py-2 text-right font-medium">Valeur</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line/60 last:border-0 align-top">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[r.tone])} aria-hidden />
                    <span className="font-medium text-ink">{r.label}</span>
                  </div>
                  <p className="mt-0.5 pl-3.5 text-2xs text-ink-mute">{r.note}</p>
                </td>
                <td className="px-3 py-2.5 text-xs text-ink-soft">{r.formula}</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-ink">
                  {r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="mb-2 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-ink-mute">
          <AlertTriangle className="h-3 w-3" strokeWidth={1.5} aria-hidden /> Observations
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
