import { Injectable } from '@nestjs/common';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';

/**
 * `AgingService` — échéancier / balance âgée des comptes tiers
 * (projet-ferme-7qfc). S'appuie sur `journal_entry_lines.due_date`
 * (Migration 0110) et sur le statut de lettrage : seules les lignes
 * OUVERTES (non lettrées) d'écritures validées représentent une
 * créance/dette encore due.
 *
 * Méthode (MVP transparent) : pour chaque ligne ouverte d'un compte
 * tiers, on classe son montant net signé (`débit − crédit`) dans une
 * tranche d'âge calculée à partir de sa `due_date` relative à la date de
 * référence. Une ligne sans `due_date` tombe dans `noDueDate`. Le total
 * par tiers = somme des tranches = solde ouvert net du compte — les
 * totaux réconcilient donc avec le grand livre auxiliaire.
 *
 * Convention de signe : un montant net positif = créance (clients 41) /
 * avance (fournisseurs 40 débiteurs) ; négatif = dette (fournisseurs 40)
 * / avoir client. On n'inverse pas le signe par sens — l'UI l'affiche
 * tel quel avec le `side` pour interprétation.
 */
const MS_PER_DAY = 86_400_000;

@Injectable()
export class AgingService {
  constructor(private readonly lineRepo: JournalEntryLineRepository) {}

  async getAging(organizationId: TenantId, options: AgingOptions = {}): Promise<AgingReport> {
    assertTenantId(organizationId);

    const side = options.side ?? 'all';
    const subClasses = side === 'client' ? ['41'] : side === 'fournisseur' ? ['40'] : ['40', '41'];
    const referenceDate = normaliseDateInput(options.referenceDate);
    const refTime = Date.parse(`${referenceDate}T00:00:00Z`);

    const lines = await this.lineRepo.listOpenPartnerLines(organizationId, {
      subClasses,
      partnerAccountId: options.partnerAccountId,
    });

    // Accumulation par compte tiers.
    const byPartner = new Map<string, MutablePartnerRow>();
    const totals = emptyMutableBuckets();

    for (const line of lines) {
      const account = line.account;
      const code = account?.code ?? '';
      const partnerSide: AgingSide = code.startsWith('41') ? 'client' : 'fournisseur';
      const net = Number(line.debit) - Number(line.credit);
      if (!Number.isFinite(net)) continue;

      let row = byPartner.get(line.accountId);
      if (row === undefined) {
        row = {
          partnerAccountId: line.accountId,
          partnerAccountCode: code,
          partnerLabel: `${code} ${account?.label ?? ''}`.trim(),
          side: partnerSide,
          buckets: emptyMutableBuckets(),
        };
        byPartner.set(line.accountId, row);
      }

      const bucket = bucketFor(line.dueDate, refTime);
      row.buckets[bucket] += net;
      row.buckets.total += net;
      totals[bucket] += net;
      totals.total += net;
    }

    const partners = [...byPartner.values()]
      .sort((a, b) => a.partnerAccountCode.localeCompare(b.partnerAccountCode))
      .map((r) => ({
        partnerAccountId: r.partnerAccountId,
        partnerAccountCode: r.partnerAccountCode,
        partnerLabel: r.partnerLabel,
        side: r.side,
        buckets: freezeBuckets(r.buckets),
      }));

    return {
      referenceDate,
      side,
      partners,
      totals: freezeBuckets(totals),
    };
  }
}

// ─── Types publics ──────────────────────────────────────────────────

export type AgingSide = 'client' | 'fournisseur';
export type AgingSideFilter = AgingSide | 'all';

export type AgingBucketKey =
  | 'notDue'
  | 'd1_30'
  | 'd31_60'
  | 'd61_90'
  | 'd90plus'
  | 'noDueDate'
  | 'total';

/** Montants par tranche, en string DECIMAL (2 décimales). */
export type AgingBuckets = Readonly<Record<AgingBucketKey, string>>;

export interface AgingPartnerRow {
  readonly partnerAccountId: string;
  readonly partnerAccountCode: string;
  readonly partnerLabel: string;
  readonly side: AgingSide;
  readonly buckets: AgingBuckets;
}

export interface AgingOptions {
  /** Date de référence ISO `YYYY-MM-DD`. Défaut : aujourd'hui (UTC). */
  readonly referenceDate?: string;
  readonly side?: AgingSideFilter;
  readonly partnerAccountId?: string;
}

export interface AgingReport {
  readonly referenceDate: string;
  readonly side: AgingSideFilter;
  readonly partners: ReadonlyArray<AgingPartnerRow>;
  readonly totals: AgingBuckets;
}

// ─── Helpers ────────────────────────────────────────────────────────

type MutableBuckets = Record<AgingBucketKey, number>;
interface MutablePartnerRow {
  partnerAccountId: string;
  partnerAccountCode: string;
  partnerLabel: string;
  side: AgingSide;
  buckets: MutableBuckets;
}

function emptyMutableBuckets(): MutableBuckets {
  return { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, noDueDate: 0, total: 0 };
}

function freezeBuckets(b: MutableBuckets): AgingBuckets {
  return {
    notDue: round2(b.notDue),
    d1_30: round2(b.d1_30),
    d31_60: round2(b.d31_60),
    d61_90: round2(b.d61_90),
    d90plus: round2(b.d90plus),
    noDueDate: round2(b.noDueDate),
    total: round2(b.total),
  };
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Classe une `due_date` dans une tranche relative à `refTime` (epoch ms,
 * minuit UTC de la date de référence). `null` → `noDueDate`. Échéance
 * dans le futur ou aujourd'hui → `notDue`. Sinon par âge en jours.
 */
function bucketFor(dueDate: string | null, refTime: number): AgingBucketKey {
  if (dueDate === null || dueDate.trim().length === 0) return 'noDueDate';
  const dueTime = Date.parse(`${dueDate}T00:00:00Z`);
  if (!Number.isFinite(dueTime)) return 'noDueDate';
  const ageDays = Math.floor((refTime - dueTime) / MS_PER_DAY);
  if (ageDays <= 0) return 'notDue';
  if (ageDays <= 30) return 'd1_30';
  if (ageDays <= 60) return 'd31_60';
  if (ageDays <= 90) return 'd61_90';
  return 'd90plus';
}

/**
 * Normalise la date de référence : valide `YYYY-MM-DD` sinon retombe sur
 * la date du jour (UTC). Pas de `Date.now()` interdit ici (code service,
 * pas script workflow).
 */
function normaliseDateInput(input: string | undefined): string {
  if (input !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim();
  }
  return new Date().toISOString().slice(0, 10);
}
