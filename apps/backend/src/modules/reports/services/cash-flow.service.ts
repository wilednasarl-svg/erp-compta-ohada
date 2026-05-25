import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { ReportsRepository } from '../repositories/reports.repository';
import { ReportsService } from './reports.service';

/**
 * Tableau des Flux de Trésorerie (TFT) — méthode INDIRECTE
 * conforme SYSCOHADA Révisé (Acte uniforme art. 8, l'un des 4
 * états financiers obligatoires).
 *
 * Source : Guide d'application SYSCOHADA Révisé, Vol. 3, pages 8-15.
 *
 * Architecture en 6 étapes :
 *   0. Pré-requis : balances N et N-1 + SIG N (pour XD = EBE et XF).
 *   1. CAFG (FA) = XD + 654 - 754 + XF + TO + RP + RQ + RS.
 *   2. ΔBFR (FB-FE) avec EXCLUSIONS strictes des comptes liés à
 *      l'investissement et au financement (485, 414, 467, 458, 4494,
 *      4751, 404, 481, 482, 4752, 472).
 *   3. ZA = FA + FB + FC + FD + FE (flux opérationnels).
 *   4. ZB = FF + FG + FH + FI + FJ (investissement).
 *   5. ZC = ZD + ZE (financement = capitaux propres + dettes fin.).
 *   6. ZG = trésorerie clôture - ouverture ; contrôle ZH = ZA+ZB+ZC.
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

/** Préfixes des comptes "trésorerie active" (classe 5 actif).  */
export const TRESORERIE_ACTIF_PREFIXES: ReadonlyArray<string> = [
  '50', '51', '52', '53', '54', '55', '56', '57',
];

/** Préfixes "trésorerie passive" (découverts bancaires, classe 5
 * inscrits au passif). 52 = banques avec solde créditeur, 56 = idem
 * caisses spéciales. La logique côté service distingue par le SIGNE
 * du solde (débit = actif, crédit = passif) plutôt que par préfixe.
 */
export const TRESORERIE_PASSIF_PREFIXES: ReadonlyArray<string> = [
  '564', '565', '566', '585',
];

/** Préfixes d'immobilisations corporelles, incorporelles, financières.  */
export const IMMOBILISATION_PREFIXES: ReadonlyArray<string> = [
  '20', '21', '22', '23', '24', '25', '26', '27',
];

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

export interface CashFlowSection {
  readonly code: string; // 'ZA' opérationnel, 'ZB' invest, 'ZC' fin.
  readonly label: string;
  readonly postes: ReadonlyArray<CashFlowPoste>;
  readonly subtotal: string;
}

export interface CashFlowPreviousSummary {
  readonly fromDate: string;
  readonly toDate: string;
  readonly openingCash: string;
  readonly closingCash: string;
  readonly netCashVariation: string;
  readonly operationalFlow: string;
  readonly investmentFlow: string;
  readonly financingFlow: string;
}

export interface CashFlowReport {
  readonly fromDate: string;
  readonly toDate: string;
  /** ZD = trésorerie nette ouverture (au début de la période). */
  readonly openingCash: string;
  /** ZA, ZB, ZC (3 sections SYSCOHADA). */
  readonly sections: ReadonlyArray<CashFlowSection>;
  /** ZG = trésorerie nette clôture. */
  readonly closingCash: string;
  /** ZH = ZG − ZD. */
  readonly netCashVariation: string;
  /**
   * Écart de cohérence = (ZA + ZB + ZC) − (ZG − ZD).
   * Doit être ~ 0 sur des données saines. Toute valeur > 1 FCFA
   * indique un défaut de mapping ou un compte non classé.
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
    private readonly reports: ReportsService,
  ) {}

  /**
   * Point d'entrée principal. Charge balances + SIG, calcule le TFT.
   *
   * NOTE : le wiring DI dans `ReportsModule` (controller + module)
   * sera fait en PR follow-up — ne pas le toucher ici.
   */
  async getCashFlow(
    organizationId: TenantId,
    query: CashFlowQuery,
  ): Promise<CashFlowReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const current = await this.computeBare(
      organizationId,
      query.fromDate,
      query.toDate,
    );

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
        operationalFlow: previous.sections[0]?.subtotal ?? '0.00',
        investmentFlow: previous.sections[1]?.subtotal ?? '0.00',
        financingFlow: previous.sections[2]?.subtotal ?? '0.00',
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

    // Mouvements de période = différence entre cumuls N et N-1 par compte.
    // (Approximation acceptable : un débit net entre deux dates = la
    //  variation du cumul débit-crédit. La distinction débit/crédit
    //  bruts est récupérée via la trial balance quand on en a besoin.)
    const trialN = await this.repo.trialBalance(organizationId, {
      fromDate,
      toDate,
    });
    const movements: PeriodMovement[] = trialN.map((r) => ({
      accountCode: r.accountCode,
      debit: Number(r.periodDebit),
      credit: Number(r.periodCredit),
    }));

    // ── Trésorerie ouverture (ZD) et clôture (ZG) ───────────────────
    const openingCash = CashFlowService.netTreasury(signedN1);
    const closingCash = CashFlowService.netTreasury(signedN);

    // ── Étape 1 : CAFG (FA) ─────────────────────────────────────────
    const xd = Number(sigN.soldes.find((s) => s.code === 'XD')?.amount ?? '0');
    const xf = Number(sigN.soldes.find((s) => s.code === 'XF')?.amount ?? '0');

    // Comptes spécifiques à la formule CAFG (par poste OHADA ou par n°).
    // 654 = VNC des immo. cédées (charge HAO côté investissement).
    // 754 = produits cession immo (côté investissement).
    // TO  = autres produits HAO (poste SYSCOHADA).
    // RP  = autres charges HAO.
    // RQ  = participation des travailleurs.
    // RS  = impôts sur le résultat.
    const c654 = CashFlowService.sumPeriodForPrefix(movements, '654', 'debit-credit');
    const c754 = CashFlowService.sumPeriodForPrefix(movements, '754', 'credit-debit');
    const to = Number(sigN.produits.find((p) => p.code === 'TO')?.amount ?? '0');
    const rp = Number(sigN.charges.find((c) => c.code === 'RP')?.amount ?? '0');
    const rq = Number(sigN.charges.find((c) => c.code === 'RQ')?.amount ?? '0');
    const rs = Number(sigN.charges.find((c) => c.code === 'RS')?.amount ?? '0');

    const fa = xd + c654 - c754 + xf + to + rp + rq + rs;

    // ── Étape 2 : Δ BFR avec exclusions strictes ────────────────────
    // FB = − Δ stocks (classe 3).
    // FC = − Δ créances ordinaires (classe 4 débitrice, hors exclusions).
    // FD = + Δ dettes ordinaires (classe 4 créditrice, hors exclusions).
    // Convention SYSCOHADA TFT (méthode indirecte) :
    //   FB = − Δ stocks            (une hausse de stocks consomme du cash)
    //   FC = − Δ créances actives  (une hausse de créances consomme du cash)
    //   FD = + Δ dettes ordinaires (une hausse de dettes libère du cash)
    // Helper deltaSignedByFilter(n1, n) = sumN − sumN1 ; on PRE-PASSE
    // (n1, n) dans cet ordre puis on prend le signe correct.
    const fb = -CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) => code.startsWith('3') && !code.startsWith('39'),
    );
    const fc = -CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) =>
        code.startsWith('4') &&
        !CashFlowService.isExcludedFromBfr(code) &&
        // Côté "créances" : net positif (compte débiteur) à au moins
        // une des deux dates.
        (CashFlowService.netForCode(signedN, code) >= 0 &&
          CashFlowService.netForCode(signedN1, code) >= 0),
    );
    const fd = CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) =>
        code.startsWith('4') &&
        !CashFlowService.isExcludedFromBfr(code) &&
        // Côté "dettes" : net négatif (compte créditeur). Note : on
        // attend que la variation des dettes contribue POSITIVEMENT
        // quand les dettes augmentent (donc when delta du net signed
        // descend, FD augmente). On inverse donc le signe ici.
        (CashFlowService.netForCode(signedN, code) < 0 ||
          CashFlowService.netForCode(signedN1, code) < 0),
    ) * -1;
    // FE = somme des variations BFR = FB + FC + FD (présentation
    // SYSCOHADA séparée pour traçabilité).
    const fe = fb + fc + fd;

    // ZA = flux opérationnels = FA + variation BFR
    const za = fa + fe;

    // ── Étape 3 : Investissement (FF à FJ) ──────────────────────────
    // FF = - acquisitions (mouvement DÉBIT cumulé sur préfixes immo, hors
    //      classe 28 amortissements et 29 dépréciations).
    const acquisitions = CashFlowService.sumDebitForPrefixes(
      movements,
      IMMOBILISATION_PREFIXES,
      (code) => !code.startsWith('28') && !code.startsWith('29'),
    );
    const ff = -acquisitions;

    // FG = - charges immobilisées (compte 20).
    const fg = -CashFlowService.sumPeriodForPrefix(movements, '20', 'debit-credit');

    // FH = + encaissements cessions = crédits sur cessions (compte 82, 754)
    //      moins variations négatives de créances cession (485, 414).
    const fh = CashFlowService.sumPeriodForPrefix(movements, '82', 'credit-debit');

    // FI = + encaissements sur 485 (créances cession immo).
    const fi = CashFlowService.sumPeriodForPrefix(movements, '485', 'credit-debit') +
      CashFlowService.sumPeriodForPrefix(movements, '414', 'credit-debit');

    // FJ = + subventions d'investissement reçues (compte 14).
    const fj = CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) => code.startsWith('14'),
    );

    const zb = ff + fg + fh + fi + fj;

    // ── Étape 4 : Financement (FK à FQ) ─────────────────────────────
    // FK = + Δ capital (souscriptions encaissées) - on prend la variation
    //      crédit du capital social (10x sauf 106 = écarts réévaluation,
    //      109 = capital non appelé).
    const fk = CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) =>
        code.startsWith('10') &&
        !code.startsWith('106') &&
        !code.startsWith('109'),
    );

    // FL = - dividendes versés (débit sur compte 465).
    const fl = -CashFlowService.sumPeriodForPrefix(movements, '465', 'debit-credit');

    // FM = + boni de liquidation / apports (4581/4582).
    const fm = CashFlowService.deltaSignedByFilter(
      signedN1,
      signedN,
      (code) => code.startsWith('4581') || code.startsWith('4582'),
    );

    // FN = sous-total capitaux propres
    const fn = fk + fl + fm;

    // FO = + nouveaux emprunts (crédit cumulé sur 16-18).
    const fo = CashFlowService.sumCreditForPrefixes(movements, DETTES_FIN_PREFIXES);

    // FP = - remboursements emprunts (débit cumulé sur 16-18).
    const fp = -CashFlowService.sumDebitForPrefixes(movements, DETTES_FIN_PREFIXES);

    // FQ = sous-total dettes financières
    const fq = fo + fp;

    const zc = fn + fq;

    // ── Étape 5 : ZH = variation totale, contrôle de cohérence ──────
    const netCashVariation = closingCash - openingCash;
    const sumFlows = za + zb + zc;
    const coherence = sumFlows - netCashVariation;

    return {
      fromDate,
      toDate,
      openingCash: openingCash.toFixed(2),
      closingCash: closingCash.toFixed(2),
      netCashVariation: netCashVariation.toFixed(2),
      coherenceCheck: coherence.toFixed(2),
      sections: [
        {
          code: 'ZA',
          label: 'FLUX DE TRÉSORERIE PROVENANT DES ACTIVITÉS OPÉRATIONNELLES',
          subtotal: za.toFixed(2),
          postes: [
            { code: 'FA', label: 'Capacité d\'Autofinancement Globale (CAFG)', amount: fa.toFixed(2), source: 'XD + 654 - 754 + XF + TO + RP + RQ + RS' },
            { code: 'FB', label: '- Variation des stocks', amount: fb.toFixed(2) },
            { code: 'FC', label: '- Variation des créances ordinaires', amount: fc.toFixed(2), source: 'classe 4 actif hors exclusions' },
            { code: 'FD', label: '+ Variation des dettes ordinaires', amount: fd.toFixed(2), source: 'classe 4 passif hors exclusions' },
            { code: 'FE', label: 'Variation du BFR liée à l\'activité', amount: fe.toFixed(2), source: 'FB + FC + FD' },
          ],
        },
        {
          code: 'ZB',
          label: 'FLUX DE TRÉSORERIE PROVENANT DES OPÉRATIONS D\'INVESTISSEMENT',
          subtotal: zb.toFixed(2),
          postes: [
            { code: 'FF', label: '- Acquisitions d\'immobilisations', amount: ff.toFixed(2), source: 'débits 20-27 hors 28/29' },
            { code: 'FG', label: '- Charges immobilisées', amount: fg.toFixed(2), source: 'classe 20' },
            { code: 'FH', label: '+ Cessions d\'immobilisations', amount: fh.toFixed(2), source: 'crédit 82' },
            { code: 'FI', label: '+ Encaissements créances cessions', amount: fi.toFixed(2), source: 'crédits 485, 414' },
            { code: 'FJ', label: '+ Subventions d\'investissement reçues', amount: fj.toFixed(2), source: 'Δ classe 14' },
          ],
        },
        {
          code: 'ZC',
          label: 'FLUX DE TRÉSORERIE PROVENANT DU FINANCEMENT',
          subtotal: zc.toFixed(2),
          postes: [
            { code: 'FK', label: '+ Augmentations de capital', amount: fk.toFixed(2), source: 'Δ classe 10 hors 106/109' },
            { code: 'FL', label: '- Dividendes versés', amount: fl.toFixed(2), source: 'débits 465' },
            { code: 'FM', label: '+ Boni de liquidation / apports', amount: fm.toFixed(2), source: 'Δ 4581/4582' },
            { code: 'FN', label: 'Sous-total capitaux propres', amount: fn.toFixed(2), source: 'FK + FL + FM' },
            { code: 'FO', label: '+ Nouveaux emprunts', amount: fo.toFixed(2), source: 'crédits 16-18' },
            { code: 'FP', label: '- Remboursements emprunts', amount: fp.toFixed(2), source: 'débits 16-18' },
            { code: 'FQ', label: 'Sous-total dettes financières', amount: fq.toFixed(2), source: 'FO + FP' },
          ],
        },
      ],
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

  /** Net signé d'un compte spécifique (ou 0 s'il n'existe pas). */
  static netForCode(signed: ReadonlyArray<SignedAccountBalance>, code: string): number {
    return signed.find((b) => b.accountCode === code)?.net ?? 0;
  }

  /**
   * Δ = sum(net_signed_N pour comptes matchant le filtre)
   *   − sum(net_signed_N1 pour comptes matchant le filtre).
   *
   * Note : on prend l'union des comptes présents dans N et N-1 pour
   * que la variation soit correcte même si un compte apparaît
   * pour la première fois (N1 → 0) ou disparaît (N → 0).
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
