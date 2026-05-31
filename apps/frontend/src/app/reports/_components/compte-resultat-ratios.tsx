'use client';

import { AlertTriangle, BarChart3, CheckCircle2, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ProfitLossReport } from '@/types/reports';

/**
 * Section « Ratios & analyse » affichée sous le Compte de Résultat. Lit les
 * Soldes Intermédiaires de Gestion (SIG : XB chiffre d'affaires, XC valeur
 * ajoutée, XD EBE, XE résultat d'exploitation, XI résultat net) calculés par
 * le moteur, en déduit la cascade de marge et les taux de rentabilité, avec le
 * DÉTAIL chiffré du calcul et une interprétation par ratio. Purement dérivé.
 */

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const fcfa = (n: number): string => nf0.format(Math.round(n));
const pct = (n: number): string => (Number.isFinite(n) ? `${(n * 100).toFixed(1)} %` : '—');

function sig(report: ProfitLossReport, ref: string): number {
  return Number(report.lines.find((l) => l.ref === ref)?.amountN ?? '0');
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
  /** Calcul en valeurs réelles, ex. « 896 542 313 / 5 128 344 922 ». */
  readonly detail: string;
  readonly value: string;
  readonly tone: Tone;
  readonly interpretation: string;
}

export function CompteResultatRatios({ report }: { readonly report: ProfitLossReport }) {
  const ca = sig(report, 'XB');
  const va = sig(report, 'XC');
  const ebe = sig(report, 'XD');
  const re = sig(report, 'XE');
  const rf = sig(report, 'XF');
  const rn = Number(report.resultat);

  // Sans chiffre d'affaires, les taux ne sont pas interprétables.
  if (ca <= 0) {
    return (
      <section className="mt-6 rounded-md border border-line bg-paper px-4 py-3 text-xs text-ink-mute">
        Ratios indisponibles : chiffre d’affaires nul sur la période.
      </section>
    );
  }

  const div = (a: number, b: number): number => (b !== 0 ? a / b : NaN);
  const ratioOf = (a: number, b: number): string => `${fcfa(a)} / ${fcfa(b)}`;
  const tauxVA = div(va, ca);
  const partTravailEtat = div(va - ebe, va); // personnel + impôts/taxes dans la VA
  const tauxEBE = div(ebe, ca);
  const tauxRE = div(re, ca);
  const tauxRF = div(rf, ca);
  const tauxNet = div(rn, ca);

  // ── Cascade de marge (chaque solde en % du CA) ───────────────────────
  const cascade: ReadonlyArray<{ label: string; value: number; ratio: number; strong?: boolean }> = [
    { label: "Chiffre d'affaires", value: ca, ratio: 1, strong: true },
    { label: 'Valeur ajoutée', value: va, ratio: tauxVA },
    { label: "Excédent brut d'exploitation", value: ebe, ratio: tauxEBE },
    { label: "Résultat d'exploitation", value: re, ratio: tauxRE },
    { label: 'Résultat net', value: rn, ratio: tauxNet, strong: true },
  ];

  const rows: RatioRow[] = [
    {
      label: 'Taux de valeur ajoutée',
      formula: 'Valeur ajoutée / Chiffre d’affaires',
      detail: ratioOf(va, ca),
      value: pct(tauxVA),
      tone: tauxVA >= 0.35 ? 'ok' : tauxVA >= 0.2 ? 'warn' : 'neutral',
      interpretation:
        tauxVA >= 0.35
          ? `Forte création de valeur : ${pct(tauxVA)} du CA reste après les achats et services externes — activité intégrée.`
          : tauxVA >= 0.2
            ? `Création de valeur modérée (${pct(tauxVA)}) : une part importante du CA part en consommations externes.`
            : `Faible intégration (${pct(tauxVA)}) : l'essentiel du CA part en achats / sous-traitance. Profil typique du BTP ou du négoce — la marge se fait sur le volume, pas sur la transformation.`,
    },
    {
      label: 'Part du travail et de l’État dans la VA',
      formula: '(Valeur ajoutée − EBE) / Valeur ajoutée',
      detail: ratioOf(va - ebe, va),
      value: pct(partTravailEtat),
      tone: partTravailEtat <= 0.7 ? 'ok' : partTravailEtat <= 0.9 ? 'warn' : 'bad',
      interpretation:
        partTravailEtat <= 0.7
          ? `${pct(partTravailEtat)} de la valeur ajoutée rémunère le personnel et les impôts/taxes ; le reste alimente l'EBE (amortissements, capital, autofinancement).`
          : partTravailEtat <= 0.9
            ? `${pct(partTravailEtat)} de la VA est absorbée par le personnel et les impôts — il reste peu pour amortir et autofinancer.`
            : `${pct(partTravailEtat)} de la VA part en charges de personnel et impôts : l'EBE est sous forte pression.`,
    },
    {
      label: 'Taux de marge brute d’exploitation (EBE)',
      formula: 'EBE / Chiffre d’affaires',
      detail: ratioOf(ebe, ca),
      value: pct(tauxEBE),
      tone: tauxEBE >= 0.15 ? 'ok' : tauxEBE >= 0.05 ? 'warn' : 'bad',
      interpretation:
        tauxEBE >= 0.15
          ? `Bonne rentabilité opérationnelle : ${pct(tauxEBE)} du CA en excédent brut, avant amortissements et frais financiers.`
          : tauxEBE >= 0.05
            ? `Rentabilité opérationnelle modeste (${pct(tauxEBE)}) : chaque 100 F de CA dégage ${(tauxEBE * 100).toFixed(1)} F d'excédent brut — peu de marge d'absorption en cas de hausse des coûts.`
            : `Rentabilité opérationnelle faible (${pct(tauxEBE)}) : l'exploitation dégage peu d'excédent — vigilance sur la structure de coûts.`,
    },
    {
      label: 'Rentabilité d’exploitation',
      formula: 'Résultat d’exploitation / Chiffre d’affaires',
      detail: ratioOf(re, ca),
      value: pct(tauxRE),
      tone: tauxRE >= 0.1 ? 'ok' : tauxRE >= 0.03 ? 'warn' : 'bad',
      interpretation:
        tauxRE >= 0.1
          ? `Solide : l'exploitation dégage ${pct(tauxRE)} de marge après amortissements.`
          : tauxRE >= 0.03
            ? `Faible (${pct(tauxRE)}) : après les dotations aux amortissements, la marge d'exploitation s'amenuise nettement par rapport à l'EBE.`
            : `Très faible (${pct(tauxRE)}) : les amortissements absorbent quasiment tout l'excédent brut.`,
    },
    {
      label: 'Marge nette',
      formula: 'Résultat net / Chiffre d’affaires',
      detail: ratioOf(rn, ca),
      value: pct(tauxNet),
      tone: rn < 0 ? 'bad' : tauxNet >= 0.05 ? 'ok' : tauxNet >= 0.02 ? 'warn' : 'bad',
      interpretation:
        rn < 0
          ? `Perte : le résultat net est négatif (${fcfa(rn)} FCFA). L'activité ne couvre pas ses charges sur la période.`
          : tauxNet >= 0.05
            ? `Confortable : sur 100 F vendus, l'entreprise conserve ${(tauxNet * 100).toFixed(1)} F après toutes charges.`
            : `Faible (${pct(tauxNet)}) : sur 100 F vendus, il ne reste que ${(tauxNet * 100).toFixed(1)} F — la rentabilité est très sensible à toute variation de coûts ou de volume.`,
    },
  ];

  if (Math.abs(rf) > 0.005) {
    rows.push({
      label: 'Poids du résultat financier',
      formula: 'Résultat financier / Chiffre d’affaires',
      detail: ratioOf(rf, ca),
      value: pct(tauxRF),
      tone: rf >= 0 ? 'ok' : tauxRF <= -0.02 ? 'bad' : 'warn',
      interpretation:
        rf >= 0
          ? `Le résultat financier est positif (${fcfa(rf)} FCFA) : les produits financiers dépassent les charges d'intérêt.`
          : `Le résultat financier ampute la rentabilité de ${pct(Math.abs(tauxRF))} du CA (${fcfa(rf)} FCFA) — poids des frais financiers.`,
    });
  }

  // ── Synthèse ─────────────────────────────────────────────────────────
  const obs: Array<{ tone: Tone; text: string }> = [];

  if (rn < 0) {
    obs.push({ tone: 'bad', text: `Exercice en perte (${fcfa(rn)} FCFA) : priorité au redressement de la marge d'exploitation.` });
  } else {
    obs.push({ tone: tauxNet >= 0.05 ? 'ok' : 'warn', text: `Résultat net bénéficiaire de ${fcfa(rn)} FCFA, soit ${pct(tauxNet)} du chiffre d'affaires.` });
  }

  if (Number.isFinite(tauxVA) && tauxVA < 0.2) {
    obs.push({
      tone: 'warn',
      text: `Activité à forte consommation externe (taux de VA ${pct(tauxVA)}) : la rentabilité dépend surtout des VOLUMES et de la maîtrise des prix d'achat (matières, sous-traitance).`,
    });
  }

  const erosion = tauxEBE - tauxNet;
  if (Number.isFinite(erosion) && erosion >= 0.02) {
    obs.push({
      tone: 'neutral',
      text: `Entre l'EBE (${pct(tauxEBE)}) et la marge nette (${pct(tauxNet)}), ${pct(erosion)} du CA est absorbé par les amortissements, le financier et les éléments hors exploitation.`,
    });
  }

  if (Number.isFinite(partTravailEtat) && partTravailEtat > 0.7) {
    obs.push({
      tone: 'warn',
      text: `La masse salariale et les impôts/taxes consomment ${pct(partTravailEtat)} de la valeur ajoutée : levier de pilotage prioritaire.`,
    });
  }

  return (
    <section className="mt-6 rounded-md border border-line bg-paper">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <BarChart3 className="h-4 w-4 shrink-0 text-accent-ink" strokeWidth={1.5} aria-hidden />
        <h3 className="font-display text-base font-medium text-ink">Ratios &amp; analyse</h3>
        <span className="ml-auto text-2xs text-ink-mute">soldes intermédiaires de gestion</span>
      </header>

      {/* Cascade de marge */}
      <div className="border-b border-line px-4 py-3">
        <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-mute">Cascade de marge (en % du CA)</p>
        <ul className="space-y-1.5">
          {cascade.map((s) => (
            <li key={s.label} className="flex items-center gap-3">
              <span className={cn('w-52 shrink-0 text-xs', s.strong ? 'font-semibold text-ink' : 'text-ink-soft')}>
                {s.label}
              </span>
              <span className="relative h-3 flex-1 overflow-hidden rounded-xs bg-sunk/60">
                <span
                  className={cn('absolute inset-y-0 left-0 rounded-xs', s.value < 0 ? 'bg-critical/60' : s.strong ? 'bg-accent/70' : 'bg-accent/40')}
                  style={{ width: `${Math.min(100, Math.max(1.5, Math.abs(s.ratio) * 100))}%` }}
                  aria-hidden
                />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-2xs tabular-nums text-ink-mute">
                {pct(s.ratio)}
              </span>
              <span className="w-32 shrink-0 text-right font-mono text-xs tabular-nums text-ink">{fcfa(s.value)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Ratios + détail + interprétations */}
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
