/**
 * Note 16B — Engagements de retraite et avantages assimilés
 * (méthode actuarielle) — Tome 3 p. 52 + Tome 2 chap. 21.
 *
 * Doctrine SYSCOHADA : présentation des engagements pour pensions,
 * indemnités de fin de carrière (IFC), médailles du travail et autres
 * avantages postérieurs à l'emploi. Évalués par la « méthode des unités
 * de crédit projetées » (DAP — dette actuarielle projetée) puis :
 *   - partie comptabilisée → compte 196 (provision pour pensions)
 *   - partie hors-bilan    → à mentionner en note annexe
 *
 * E2 — Sources de données :
 *   1. **Partie provisionnée** : balance créditeur du compte 196 à la
 *      clôture (`deps.reports.accountBalancesAsAt`).
 *   2. **Partie hors-bilan + métadonnées actuarielles** : evaluations
 *      actives du module `actuarial-commitments`
 *      (`deps.actuarialCommitments.listActiveByOrg`).
 *
 * Statut produit :
 *   - rows présentes  ⇒ COMPUTED (tableau ventilé par type)
 *   - rows vides      ⇒ applicable, freeComment laissé au comptable
 *
 * Le tableau est ventilé par type d'engagement, avec une ligne TOTAL.
 * Colonnes : engagementBrut | provisionComptabilisee | ecartNonProvisionne
 *            | dateEvaluation | actuaire.
 */
import type {
  ActuarialCommitmentSnapshot,
  ActuarialCommitmentType,
} from '../../../../actuarial-commitments/types/actuarial-commitment.types';
import type { NoteHandler, NoteRow } from '../types';

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

const TYPE_LABELS: Readonly<Record<ActuarialCommitmentType, string>> = {
  retraite_ifc: 'Indemnités de fin de carrière (IFC)',
  medaille_du_travail: 'Médailles du travail',
  preavis_legal: 'Préavis légal',
  autre: 'Autres engagements postérieurs à l’emploi',
};

interface AggregateLine {
  engagementBrut: number;
  provisionComptabilisee: number;
  ecartNonProvisionne: number;
  dateEvaluation: string;
  actuaire: string;
}

export const handleN16bEngagementsRetraite: NoteHandler = async (ctx, deps) => {
  const rows: NoteRow[] = [];

  // ─── Source 1 — Engagements actuariels (E2 module) ──────────────────
  const snapshots: ReadonlyArray<ActuarialCommitmentSnapshot> =
    (await deps.actuarialCommitments?.listActiveByOrg(ctx.organizationId)) ?? [];

  // Agrégation par type pour collapse les doublons éventuels (le service
  // expose latest-by-type côté API, mais le contrat `listActiveByOrg`
  // peut renvoyer plusieurs lignes en lecture brute).
  const byType = new Map<ActuarialCommitmentType, AggregateLine>();
  for (const snap of snapshots) {
    const agg = byType.get(snap.commitmentType) ?? {
      engagementBrut: 0,
      provisionComptabilisee: 0,
      ecartNonProvisionne: 0,
      dateEvaluation: snap.valuationDate,
      actuaire: snap.actuaryName ?? '',
    };
    agg.engagementBrut += num(snap.obligationAmount);
    agg.provisionComptabilisee += num(snap.provisionedAmount);
    agg.ecartNonProvisionne += num(snap.offBalanceSheetAmount);
    // Plus récente date de valuation gagne ; actuaire = dernier renseigné.
    if (snap.valuationDate > agg.dateEvaluation) {
      agg.dateEvaluation = snap.valuationDate;
      agg.actuaire = snap.actuaryName ?? agg.actuaire;
    }
    byType.set(snap.commitmentType, agg);
  }

  // ─── Source 2 — Solde compte 196 (provisions comptables) ────────────
  // Représente la part actuariale déjà passée en provision MAIS qui
  // ne serait pas (encore) rattachée à un snapshot E2. On la remonte
  // sous le bucket `autre` si aucun snapshot ne la couvre, pour ne pas
  // perdre la donnée comptable doctrinale.
  const balances = await deps.reports.accountBalancesAsAt(
    ctx.organizationId as string,
    ctx.periodEnd,
  );
  let provision196 = 0;
  for (const b of balances) {
    if (!b.accountCode.startsWith('196')) continue;
    const net = num(b.totalCredit) - num(b.totalDebit); // provision ⇒ créditeur
    if (Math.abs(net) < 0.005) continue;
    provision196 += net;
  }

  const provisionFromSnapshots = Array.from(byType.values()).reduce(
    (acc, l) => acc + l.provisionComptabilisee,
    0,
  );
  const provisionDelta = provision196 - provisionFromSnapshots;
  if (provisionDelta > 0.005) {
    const agg = byType.get('autre') ?? {
      engagementBrut: 0,
      provisionComptabilisee: 0,
      ecartNonProvisionne: 0,
      dateEvaluation: ctx.periodEnd,
      actuaire: '',
    };
    agg.engagementBrut += provisionDelta;
    agg.provisionComptabilisee += provisionDelta;
    byType.set('autre', agg);
  }

  // ─── Projection en rows ─────────────────────────────────────────────
  const ordered: ActuarialCommitmentType[] = [
    'retraite_ifc',
    'medaille_du_travail',
    'preavis_legal',
    'autre',
  ];

  let totBrut = 0;
  let totProv = 0;
  let totEcart = 0;

  for (const t of ordered) {
    const agg = byType.get(t);
    if (!agg) continue;
    totBrut += agg.engagementBrut;
    totProv += agg.provisionComptabilisee;
    totEcart += agg.ecartNonProvisionne;
    rows.push({
      key: t,
      label: TYPE_LABELS[t],
      values: {
        engagementBrut: fmt(agg.engagementBrut),
        provisionComptabilisee: fmt(agg.provisionComptabilisee),
        ecartNonProvisionne: fmt(agg.ecartNonProvisionne),
        dateEvaluation: agg.dateEvaluation,
        actuaire: agg.actuaire,
      },
    });
  }

  if (rows.length > 0) {
    rows.push({
      key: 'TOTAL',
      label: 'TOTAL engagements de retraite & avantages assimilés',
      values: {
        engagementBrut: fmt(totBrut),
        provisionComptabilisee: fmt(totProv),
        ecartNonProvisionne: fmt(totEcart),
        dateEvaluation: '',
        actuaire: '',
      },
    });
  }

  // Applicable=true par défaut — la note reste dans la liasse même sans
  // engagement chiffré (commentaire libre doctrinal pour "néant").
  return { rows, applicable: true };
};
