import { forwardRef, Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ReportsRepository } from '../repositories/reports.repository';
import { ReportsService } from './reports.service';
import { getTftLabel, TFT_POSTES } from './postes/tft-postes';

/**
 * Tableau des Flux de Trésorerie (TFT) — méthode INDIRECTE conforme
 * SYSCOHADA Révisé (Acte uniforme art. 8 ; Vol. 3 page 34).
 *
 * Nomenclature OFFICIELLE des codes Z (doctrine Tome 3, page 34) :
 *   - ZA = Trésorerie nette au 1er janvier (ouverture)
 *   - ZB = Flux opérationnels (somme FA à FE)
 *   - ZC = Flux d'investissement (somme FF à FJ)
 *   - ZD = Flux de financement par capitaux propres (somme FK à FN)
 *   - ZE = Flux de financement par capitaux étrangers (somme FO à FQ)
 *   - ZF = Flux de financement total (ZD + ZE)
 *   - ZG = Variation totale de trésorerie (ZB + ZC + ZF)
 *   - ZH = Trésorerie nette au 31 décembre (ZA + ZG)
 *
 * Architecture en 6 étapes :
 *   0. Pré-requis : balances N et N-1 + SIG N (pour XD = EBE et XF).
 *   1. CAFG (FA) = XD + 654 - 754 + XF + TO + RP + RQ + RS.
 *   2. ΔBFR (FB-FE) avec EXCLUSIONS strictes des comptes liés à
 *      l'investissement et au financement (485, 414, 467, 458, 4494,
 *      4751, 404, 481, 482, 4752, 472).
 *   3. ZB = FA + FB + FC + FD + FE.
 *   4. ZC = FF + FG + FH + FI + FJ.
 *   5. ZD = FK + FL + FM + FN ; ZE = FO + FP + FQ ; ZF = ZD + ZE.
 *   6. ZG = ZB + ZC + ZF ; ZH = ZA + ZG ; contrôle ZH ≈ trésorerie nette
 *      des comptes classe 5 à toDate.
 *
 * Le référentiel des libellés et codes est `./postes/tft-postes.ts`.
 */

/** Comptes du grand livre qui sont EXCLUS des variations BFR.
 *
 * Article 9 du Vol. 3 SYSCOHADA : la variation BFR de la partie
 * "flux opérationnels" ne doit pas inclure les mouvements liés
 * à l'investissement ou au financement, qui sont déjà comptés
 * dans leur section dédiée.
 */
export const BFR_EXCLUDED_PREFIXES: ReadonlyArray<string> = [
  '485', // Créances sur cession d'immobilisations (investissement)
  '414', // Créances sur cession non courante (investissement)
  '467', // Apporteurs / Associés-opérations sur capital (financement)
  '458', // Associés-opérations sur capital
  '4581', // Associés-opérations sur capital - boni de liquidation
  '4582', // Associés-opérations sur capital - subv. invest.
  '4494', // Subventions à recevoir (financement)
  '4751', // Compte de transfert SYSCOHADA opérations courantes
  '4752', // Compte de transfert opérations financières
  '404', // Fournisseurs d'investissement (investissement)
  '481', // Concessions et droits similaires (invest. financé)
  '482', // Fournisseurs d'investissement (locations financement)
  '472', // Dividendes à payer (financement)
  '465', // Associés - dividendes à payer
];

/** Préfixes des comptes "actif circulant HAO" (poste BA du bilan).
 *
 * Le poste BA SYSCOHADA agrège 485 et 488. Le compte 485 (créances sur
 * cessions d'immobilisations) est EXCLU du BFR (Article 9) car il relève
 * des flux d'investissement (capturé en FI). Le poste FB du TFT porte donc
 * en pratique sur 488 et assimilés, après application de la liste
 * `BFR_EXCLUDED_PREFIXES`.
 */
export const ACTIF_CIRCULANT_HAO_PREFIXES: ReadonlyArray<string> = ['485', '488'];

/** Préfixes des comptes "trésorerie active" (classe 5 actif).  */
export const TRESORERIE_ACTIF_PREFIXES: ReadonlyArray<string> = [
  '50',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
];

/** Préfixes "trésorerie passive" (découverts bancaires, classe 5
 * inscrits au passif). 52 = banques avec solde créditeur, 56 = idem
 * caisses spéciales. La logique côté service distingue par le SIGNE
 * du solde (débit = actif, crédit = passif) plutôt que par préfixe.
 */
export const TRESORERIE_PASSIF_PREFIXES: ReadonlyArray<string> = ['564', '565', '566', '585'];

/** Préfixes d'immobilisations corporelles, incorporelles, financières.  */
export const IMMOBILISATION_PREFIXES: ReadonlyArray<string> = [
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
];

/** Préfixes d'immobilisations financières (titres, prêts, dépôts).  */
export const IMMOBILISATION_FIN_PREFIXES: ReadonlyArray<string> = ['26', '27'];

/** Préfixes des dettes financières (emprunts long terme).  */
export const DETTES_FIN_PREFIXES: ReadonlyArray<string> = ['16', '17', '18'];

/** Préfixes du capital + primes (hors écarts et capital non appelé).  */
export const CAPITAL_PREFIXES: ReadonlyArray<string> = ['101', '102', '103', '104', '105'];

/** Préfixes des subventions d'investissement reçues.  */
export const SUBVENTION_INVEST_PREFIXES: ReadonlyArray<string> = ['14'];

// ─── Types publics ──────────────────────────────────────────────────

export interface CashFlowPoste {
  readonly code: string; // 'FA', 'FB', ..., 'FQ'
  readonly label: string;
  readonly amount: string; // DECIMAL string, peut être négatif
  readonly source?: string;
}

/**
 * Une section TFT regroupe des postes de détail et expose un sous-total
 * de section (ZB, ZC, ZD, ZE selon la nomenclature p. 34).
 */
export interface CashFlowSection {
  /** Code du sous-total de section : ZB, ZC, ZD ou ZE.  */
  readonly code: 'ZB' | 'ZC' | 'ZD' | 'ZE';
  readonly label: string;
  readonly postes: ReadonlyArray<CashFlowPoste>;
  readonly subtotal: string;
}

/**
 * Résumé du TFT de la période N-1, utilisé pour la colonne comparatif.
 * Reprend uniquement les sous-totaux et la trésorerie (la doctrine
 * n'impose le détail poste par poste qu'en N).
 */
export interface CashFlowPreviousSummary {
  readonly fromDate: string;
  readonly toDate: string;
  readonly openingCash: string; // ZA
  readonly closingCash: string; // ZH
  readonly netCashVariation: string; // ZG
  readonly operatingFlow: string; // ZB
  readonly investingFlow: string; // ZC
  readonly financingFlowEquity: string; // ZD
  readonly financingFlowDebt: string; // ZE
  readonly financingFlowTotal: string; // ZF
}

/**
 * Rapport TFT conforme doctrine SYSCOHADA Révisé Tome 3 page 34.
 *
 * Les codes Z respectent strictement la nomenclature officielle :
 *   - ZA : ouverture
 *   - ZB : opérationnel
 *   - ZC : investissement
 *   - ZD : financement capitaux propres
 *   - ZE : financement capitaux étrangers
 *   - ZF : financement total (= ZD + ZE)
 *   - ZG : variation totale (= ZB + ZC + ZF)
 *   - ZH : clôture (= ZA + ZG)
 */
export interface CashFlowReport {
  readonly fromDate: string;
  readonly toDate: string;
  /** ZA — Trésorerie nette au 1er janvier (ouverture). */
  readonly openingCash: string;
  /** Section ZB : flux opérationnels (FA-FE + sous-total). */
  readonly operatingFlows: CashFlowSection;
  /** Section ZC : flux d'investissement (FF-FJ + sous-total). */
  readonly investingFlows: CashFlowSection;
  /** Section ZD : flux de financement par capitaux propres (FK-FN). */
  readonly financingFlowsEquity: CashFlowSection;
  /** Section ZE : flux de financement par capitaux étrangers (FO-FQ). */
  readonly financingFlowsDebt: CashFlowSection;
  /** ZF — sous-total financement total (= ZD + ZE). */
  readonly financingFlowsTotal: string;
  /** ZG — variation totale de trésorerie (= ZB + ZC + ZF). */
  readonly netCashVariation: string;
  /** ZH — Trésorerie nette au 31 décembre (= ZA + ZG). */
  readonly closingCash: string;
  /**
   * Contrôle de cohérence : |ZH − trésorerie nette comptes classe 5
   * à toDate|. Doit être ~ 0 sur des données saines. Toute valeur > 1
   * FCFA indique un défaut de mapping ou un compte non classé.
   */
  readonly coherenceCheck: string;
  readonly previous?: CashFlowPreviousSummary;
}

export interface CashFlowQuery {
  readonly fromDate: string;
  readonly toDate: string;
  /** Si fourni, comparatif N-1 sur la période [previousFromDate, previousToDate].  */
  readonly previousFromDate?: string;
  readonly previousToDate?: string;
}

// ─── Inputs pour le calcul (testables sans I/O) ─────────────────────

/**
 * Solde signed d'un compte sur une période : positif = solde débiteur
 * net, négatif = solde créditeur net. C'est la forme utilisée par les
 * algorithmes internes.
 */
export interface SignedAccountBalance {
  readonly accountCode: string;
  /** balance = totalDebit - totalCredit, cumulé à la date.  */
  readonly net: number;
}

/**
 * Mouvements de période d'un compte : utilisés pour le calcul des
 * variations brutes et l'identification des acquisitions/cessions.
 */
export interface PeriodMovement {
  readonly accountCode: string;
  readonly debit: number;
  readonly credit: number;
}

// ─── Service ────────────────────────────────────────────────────────

@Injectable()
export class CashFlowService {
  constructor(
    private readonly repo: ReportsRepository,
    // `forwardRef` casse un cycle d'import ES (reports.service →
    // from-balance-multi-period → cash-flow.service → reports.service) qui
    // laissait `ReportsService` undefined dans les paramtypes au boot →
    // « Nest can't resolve dependencies of CashFlowService » (502). NE PAS retirer.
    @Inject(forwardRef(() => ReportsService)) private readonly reports: ReportsService,
  ) {}

  /**
   * Point d'entrée principal. Charge balances + SIG, calcule le TFT
   * conforme à la nomenclature officielle SYSCOHADA Révisé p. 34.
   */
  async getCashFlow(organizationId: TenantId, query: CashFlowQuery): Promise<CashFlowReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const current = await this.computeBare(organizationId, query.fromDate, query.toDate);

    if (query.previousFromDate === undefined || query.previousToDate === undefined) {
      return current;
    }

    this.assertDateRange(query.previousFromDate, query.previousToDate);
    const previous = await this.computeBare(
      organizationId,
      query.previousFromDate,
      query.previousToDate,
    );

    return {
      ...current,
      previous: {
        fromDate: previous.fromDate,
        toDate: previous.toDate,
        openingCash: previous.openingCash,
        closingCash: previous.closingCash,
        netCashVariation: previous.netCashVariation,
        operatingFlow: previous.operatingFlows.subtotal,
        investingFlow: previous.investingFlows.subtotal,
        financingFlowEquity: previous.financingFlowsEquity.subtotal,
        financingFlowDebt: previous.financingFlowsDebt.subtotal,
        financingFlowTotal: previous.financingFlowsTotal,
      },
    };
  }

  private async computeBare(
    organizationId: TenantId,
    fromDate: string,
    toDate: string,
  ): Promise<CashFlowReport> {
    // Balance N-1 = état des comptes au jour avant fromDate.
    // Balance N = état des comptes à toDate.
    const previousToDate = CashFlowService.dayBefore(fromDate);

    const [balanceN, balanceN1, sigN] = await Promise.all([
      this.repo.accountBalancesAsAt(organizationId, toDate),
      this.repo.accountBalancesAsAt(organizationId, previousToDate),
      this.reports.getSig(organizationId, { fromDate, toDate }),
    ]);

    const signedN = CashFlowService.toSignedBalances(balanceN);
    const signedN1 = CashFlowService.toSignedBalances(balanceN1);

    const trialN = await this.repo.trialBalance(organizationId, {
      fromDate,
      toDate,
    });
    const movements: PeriodMovement[] = trialN.map((r) => ({
      accountCode: r.accountCode,
      debit: Number(r.periodDebit),
      credit: Number(r.periodCredit),
    }));

    // ── ZA / ZH : trésorerie nette à l'ouverture et à la clôture ───
    const openingCash = CashFlowService.netTreasury(signedN1);
    const treasuryAtToDate = CashFlowService.netTreasury(signedN);

    // ── FA — CAFG ──────────────────────────────────────────────────
    const xd = Number(sigN.soldes.find((s) => s.code === 'XD')?.amount ?? '0');
    const xf = Number(sigN.soldes.find((s) => s.code === 'XF')?.amount ?? '0');
    const c654 = CashFlowService.sumPeriodForPrefix(movements, '654', 'debit-credit');
    const c754 = CashFlowService.sumPeriodForPrefix(movements, '754', 'credit-debit');
    const to = Number(sigN.produits.find((p) => p.code === 'TO')?.amount ?? '0');
    const rp = Number(sigN.charges.find((c) => c.code === 'RP')?.amount ?? '0');
    const rq = Number(sigN.charges.find((c) => c.code === 'RQ')?.amount ?? '0');
    const rs = Number(sigN.charges.find((c) => c.code === 'RS')?.amount ?? '0');
    const fa = xd + c654 - c754 + xf + to + rp + rq + rs;

    // ── FB-FE — variations BFR (avec exclusions strictes) ──────────
    // FB = - Δ actif circulant HAO (poste BA du bilan = préfixes 485/488).
    //      Le compte 485 (créances sur cessions d'immobilisations) est
    //      EXCLU du BFR (Article 9) : il relève des flux d'investissement
    //      et est déjà capturé dans FI. Reste donc 488 et assimilés HAO.
    //      Même mécanique que FC/FD : −Δ(net signé), exclusions BFR.
    const fb = -CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) =>
        CashFlowService.isActifCirculantHao(code) && !CashFlowService.isExcludedFromBfr(code),
    );

    // FC = - Δ stocks (classe 3 hors 39 dépréciations)
    const fc = -CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) => code.startsWith('3') && !code.startsWith('39'),
    );

    // FD = - Δ créances ordinaires (classe 4 actif hors exclusions).
    //      L'actif circulant HAO (488) est traité par FB → exclu ici pour
    //      éviter tout double comptage.
    const fd = -CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) =>
        code.startsWith('4') &&
        !CashFlowService.isExcludedFromBfr(code) &&
        !CashFlowService.isActifCirculantHao(code) &&
        CashFlowService.netForCode(signedN, code) >= 0 &&
        CashFlowService.netForCode(signedN1, code) >= 0,
    );

    // FE = + Δ dettes ordinaires (classe 4 passif hors exclusions).
    //      L'actif circulant HAO (488) est traité par FB → exclu ici.
    const fe = -CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) =>
        code.startsWith('4') &&
        !CashFlowService.isExcludedFromBfr(code) &&
        !CashFlowService.isActifCirculantHao(code) &&
        (CashFlowService.netForCode(signedN, code) < 0 ||
          CashFlowService.netForCode(signedN1, code) < 0),
    );

    // ZB = FA + FB + FC + FD + FE
    const zb = fa + fb + fc + fd + fe;

    // ── FF-FJ — flux d'investissement (grille conforme Tome 3 p.34) ──
    // FF = - acquisitions d'immobilisations INCORPORELLES (débit 20/21,
    //      hors 28/29 amort./déprec.)
    const ff = -CashFlowService.sumDebitForPrefixes(
      movements,
      ['20', '21'],
      (code) => !code.startsWith('28') && !code.startsWith('29'),
    );

    // FG = - acquisitions d'immobilisations CORPORELLES (débit 22-25,
    //      hors 28/29)
    const fg = -CashFlowService.sumDebitForPrefixes(
      movements,
      ['22', '23', '24', '25'],
      (code) => !code.startsWith('28') && !code.startsWith('29'),
    );

    // FH = - acquisitions d'immobilisations FINANCIÈRES (débit 26/27)
    const fh = -CashFlowService.sumDebitForPrefixes(
      movements,
      IMMOBILISATION_FIN_PREFIXES,
      (code) => !code.startsWith('28') && !code.startsWith('29'),
    );

    // FI = + encaissements sur cessions d'immobilisations INCORPORELLES
    //      et CORPORELLES : produit de cession (crédit 82) corrigé de la
    //      variation des créances de cession non encaissées (485/414),
    //      pour passer du produit comptable à l'encaissement réel.
    const deltaCreancesCession = CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) => code.startsWith('485') || code.startsWith('414'),
    );
    const fi =
      CashFlowService.sumPeriodForPrefix(movements, '82', 'credit-debit') - deltaCreancesCession;

    // FJ = + encaissements sur cessions d'immobilisations FINANCIÈRES
    //      (crédit 26/27)
    const fj = CashFlowService.sumCreditForPrefixes(movements, IMMOBILISATION_FIN_PREFIXES);

    // ZC = FF + FG + FH + FI + FJ (total inchangé vs grille précédente :
    // simple ré-affectation incorp/corp/fin conforme au modèle officiel).
    const zc = ff + fg + fh + fi + fj;

    // ── FK-FN — flux financement capitaux propres ──────────────────
    // FK = + augmentations de capital (Δ classe 10 hors 106 écarts réval.
    //      et 109 capital non appelé)
    const fk = CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) => code.startsWith('10') && !code.startsWith('106') && !code.startsWith('109'),
    );

    // FL = + subventions d'investissement reçues (Δ classe 14)
    const fl = CashFlowService.deltaSignedByFilter(signedN1, signedN, (code) =>
      code.startsWith('14'),
    );

    // FM = - prélèvements sur le capital (débits 4581/4582 — opérations
    //      sur capital côté retraits exploitant / boni liquidation négatif)
    const fm = -CashFlowService.sumDebitForPrefixes(movements, ['4581', '4582']);

    // FN = - dividendes versés (débit 465)
    const fn = -CashFlowService.sumPeriodForPrefix(movements, '465', 'debit-credit');

    // ZD = FK + FL + FM + FN
    const zd = fk + fl + fm + fn;

    // ── FO-FQ — flux financement capitaux étrangers ────────────────
    // FO = + emprunts nouveaux (crédit cumulé sur 16-17)
    const fo = CashFlowService.sumCreditForPrefixes(movements, ['16', '17']);

    // FP = + autres dettes financières (crédit cumulé sur 18)
    const fp = CashFlowService.sumCreditForPrefixes(movements, ['18']);

    // FQ = - remboursements emprunts (débit cumulé sur 16-18)
    const fq = -CashFlowService.sumDebitForPrefixes(movements, DETTES_FIN_PREFIXES);

    // ZE = FO + FP + FQ
    const ze = fo + fp + fq;

    // ── ZF, ZG, ZH ─────────────────────────────────────────────────
    const zf = zd + ze;
    const zg = zb + zc + zf;
    const zh = openingCash + zg;

    // Contrôle : ZH calculé doit ≈ trésorerie nette des comptes classe 5
    // à toDate. Un écart > 1 FCFA signale un défaut de mapping.
    const coherence = zh - treasuryAtToDate;

    return {
      fromDate,
      toDate,
      openingCash: openingCash.toFixed(2),
      operatingFlows: {
        code: 'ZB',
        label: getTftLabel('ZB'),
        subtotal: zb.toFixed(2),
        postes: [
          {
            code: 'FA',
            label: getTftLabel('FA'),
            amount: fa.toFixed(2),
            source: 'XD + 654 - 754 + XF + TO + RP + RQ + RS',
          },
          {
            code: 'FB',
            label: getTftLabel('FB'),
            amount: fb.toFixed(2),
            source: 'actif circulant HAO 485/488 (485 exclu BFR → section invest.)',
          },
          {
            code: 'FC',
            label: getTftLabel('FC'),
            amount: fc.toFixed(2),
            source: 'classe 3 hors 39',
          },
          {
            code: 'FD',
            label: getTftLabel('FD'),
            amount: fd.toFixed(2),
            source: 'classe 4 actif hors exclusions',
          },
          {
            code: 'FE',
            label: getTftLabel('FE'),
            amount: fe.toFixed(2),
            source: 'classe 4 passif hors exclusions',
          },
        ],
      },
      investingFlows: {
        code: 'ZC',
        label: getTftLabel('ZC'),
        subtotal: zc.toFixed(2),
        postes: [
          {
            code: 'FF',
            label: getTftLabel('FF'),
            amount: ff.toFixed(2),
            source: 'débits 20-21 hors 28/29',
          },
          {
            code: 'FG',
            label: getTftLabel('FG'),
            amount: fg.toFixed(2),
            source: 'débits 22-25 hors 28/29',
          },
          { code: 'FH', label: getTftLabel('FH'), amount: fh.toFixed(2), source: 'débits 26-27' },
          {
            code: 'FI',
            label: getTftLabel('FI'),
            amount: fi.toFixed(2),
            source: 'crédit 82 − Δ(485+414)',
          },
          { code: 'FJ', label: getTftLabel('FJ'), amount: fj.toFixed(2), source: 'crédits 26-27' },
        ],
      },
      financingFlowsEquity: {
        code: 'ZD',
        label: getTftLabel('ZD'),
        subtotal: zd.toFixed(2),
        postes: [
          {
            code: 'FK',
            label: getTftLabel('FK'),
            amount: fk.toFixed(2),
            source: 'Δ classe 10 hors 106/109',
          },
          { code: 'FL', label: getTftLabel('FL'), amount: fl.toFixed(2), source: 'Δ classe 14' },
          {
            code: 'FM',
            label: getTftLabel('FM'),
            amount: fm.toFixed(2),
            source: 'débits 4581/4582',
          },
          { code: 'FN', label: getTftLabel('FN'), amount: fn.toFixed(2), source: 'débits 465' },
        ],
      },
      financingFlowsDebt: {
        code: 'ZE',
        label: getTftLabel('ZE'),
        subtotal: ze.toFixed(2),
        postes: [
          { code: 'FO', label: getTftLabel('FO'), amount: fo.toFixed(2), source: 'crédits 16-17' },
          { code: 'FP', label: getTftLabel('FP'), amount: fp.toFixed(2), source: 'crédits 18' },
          { code: 'FQ', label: getTftLabel('FQ'), amount: fq.toFixed(2), source: 'débits 16-18' },
        ],
      },
      financingFlowsTotal: zf.toFixed(2),
      netCashVariation: zg.toFixed(2),
      closingCash: zh.toFixed(2),
      coherenceCheck: coherence.toFixed(2),
    };
  }

  // ─── Helpers (statiques pour faciliter les tests) ─────────────────

  /**
   * Convertit un tableau de soldes brut (totalDebit, totalCredit) en
   * soldes signés (net = D - C, modulé par isOpposing). Un compte
   * `isOpposing=true` (typique des dépréciations 28/29/39/49/59)
   * voit son signe inversé pour s'aligner sur la convention bilan.
   */
  static toSignedBalances(
    rows: ReadonlyArray<{
      accountCode: string;
      totalDebit: string;
      totalCredit: string;
      isOpposing: boolean;
    }>,
  ): SignedAccountBalance[] {
    return rows.map((r) => {
      const d = Number(r.totalDebit);
      const c = Number(r.totalCredit);
      const net = d - c;
      return {
        accountCode: r.accountCode,
        net: r.isOpposing ? -net : net,
      };
    });
  }

  /**
   * Trésorerie nette = somme des soldes nets des comptes 50-58.
   * Les soldes débiteurs (banques actives) comptent positivement ;
   * les soldes créditeurs (découverts) comptent négativement par
   * construction du signed net.
   */
  static netTreasury(signed: ReadonlyArray<SignedAccountBalance>): number {
    return signed
      .filter((b) => CashFlowService.isTreasuryAccount(b.accountCode))
      .reduce((s, b) => s + b.net, 0);
  }

  static isTreasuryAccount(code: string): boolean {
    // Classe 5 entière (50-58), sauf 59 dépréciations.
    if (code.startsWith('59')) return false;
    return code.startsWith('5');
  }

  /**
   * Test d'appartenance aux préfixes exclus du BFR (cf. tome 3 page 11).
   * Les préfixes sont testés en ordre de longueur décroissante pour que
   * `4581` matche avant `458` ; `465` matche tel quel.
   */
  static isExcludedFromBfr(code: string): boolean {
    return BFR_EXCLUDED_PREFIXES.some((p) => code.startsWith(p));
  }

  /**
   * Test d'appartenance à l'actif circulant HAO (poste BA = 485/488).
   * Utilisé pour router ces comptes vers FB et les retirer de FD/FE
   * (évite le double comptage de la variation BFR).
   */
  static isActifCirculantHao(code: string): boolean {
    return ACTIF_CIRCULANT_HAO_PREFIXES.some((p) => code.startsWith(p));
  }

  /** Net signé d'un compte spécifique (ou 0 s'il n'existe pas). */
  static netForCode(signed: ReadonlyArray<SignedAccountBalance>, code: string): number {
    return signed.find((b) => b.accountCode === code)?.net ?? 0;
  }

  /**
   * Δ = sum(net_signed_N pour comptes matchant le filtre)
   *   − sum(net_signed_N1 pour comptes matchant le filtre).
   */
  static deltaSignedByFilter(
    n1: ReadonlyArray<SignedAccountBalance>,
    n: ReadonlyArray<SignedAccountBalance>,
    filter: (code: string) => boolean,
  ): number {
    const sumN = n.filter((b) => filter(b.accountCode)).reduce((s, b) => s + b.net, 0);
    const sumN1 = n1.filter((b) => filter(b.accountCode)).reduce((s, b) => s + b.net, 0);
    return sumN - sumN1;
  }

  /** Somme des débits cumulés sur les comptes matchant un préfixe (+ filtre).  */
  static sumDebitForPrefixes(
    movements: ReadonlyArray<PeriodMovement>,
    prefixes: ReadonlyArray<string>,
    extraFilter?: (code: string) => boolean,
  ): number {
    return movements
      .filter(
        (m) =>
          prefixes.some((p) => m.accountCode.startsWith(p)) &&
          (extraFilter ? extraFilter(m.accountCode) : true),
      )
      .reduce((s, m) => s + m.debit, 0);
  }

  /** Somme des crédits cumulés sur les comptes matchant un préfixe.  */
  static sumCreditForPrefixes(
    movements: ReadonlyArray<PeriodMovement>,
    prefixes: ReadonlyArray<string>,
  ): number {
    return movements
      .filter((m) => prefixes.some((p) => m.accountCode.startsWith(p)))
      .reduce((s, m) => s + m.credit, 0);
  }

  /**
   * Somme nette de période pour un préfixe, dans le sens demandé.
   *   - 'debit-credit'  : pour les comptes de charges (classe 6, 654…)
   *   - 'credit-debit'  : pour les comptes de produits (classe 7, 754…)
   * Renvoie une valeur >= 0 en convention SIG si les mouvements sont
   * "naturels" ; négative sinon (contre-passation).
   */
  static sumPeriodForPrefix(
    movements: ReadonlyArray<PeriodMovement>,
    prefix: string,
    direction: 'debit-credit' | 'credit-debit',
  ): number {
    const matching = movements.filter((m) => m.accountCode.startsWith(prefix));
    if (direction === 'debit-credit') {
      return matching.reduce((s, m) => s + m.debit - m.credit, 0);
    }
    return matching.reduce((s, m) => s + m.credit - m.debit, 0);
  }

  /** Renvoie la date "YYYY-MM-DD" du jour précédant `ymd`. */
  static dayBefore(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /** Expose la liste exhaustive des postes TFT (pour les exports). */
  static get postesReferentiel(): typeof TFT_POSTES {
    return TFT_POSTES;
  }

  private assertDateRange(fromDate: string, toDate: string): void {
    if (!ReportsService.isYmd(fromDate) || !ReportsService.isYmd(toDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `Both fromDate and toDate must be YYYY-MM-DD (got ${fromDate}, ${toDate}).`,
      });
    }
    if (fromDate > toDate) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `fromDate must be <= toDate (got ${fromDate} > ${toDate}).`,
      });
    }
  }
}
