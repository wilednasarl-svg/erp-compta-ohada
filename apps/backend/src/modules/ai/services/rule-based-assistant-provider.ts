import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { SyscohadaDomain } from '../../syscohada-knowledge/services/syscohada-knowledge.service';
import { SyscohadaKnowledgeService } from '../../syscohada-knowledge/services/syscohada-knowledge.service';
import type { AssistantAnswer, AssistantContext, AssistantProvider } from './assistant-provider';

/**
 * Wave 2 implementation — déterministe, basée sur du SQL d'agrégation.
 * Couvre 5 patterns canoniques (cf. README issue projet-ferme-5ja).
 *
 * Chaque pattern :
 *   1. Détecte l'intent par regex sur la question normalisée
 *      (lowercased, accents stripped, ponctuation finale ignorée).
 *   2. Récupère un compte / une période / un mot-clé dans la question.
 *   3. Exécute une seule requête SQL d'agrégation (tenant-scopée).
 *   4. Compose une réponse française + une payload `supportingData`.
 *
 * Quand aucun pattern ne matche, on renvoie `matchedIntent=null` —
 * c'est l'instruction pour l'UI d'afficher "Question non reconnue
 * (provider rule-based v1, reformulez ou attendez le LLM en wave 3)".
 */
@Injectable()
export class RuleBasedAssistantProvider implements AssistantProvider {
  public readonly id = 'rule-based-v1';

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Optional() private readonly knowledge?: SyscohadaKnowledgeService,
  ) {}

  async ask(question: string, context: AssistantContext): Promise<AssistantAnswer> {
    const normalised = this.normalise(question);

    const doctrineAnswer = await this.trySyscohadaKnowledge(question, normalised);
    if (doctrineAnswer) return doctrineAnswer;

    const accountEvolution = this.matchAccountEvolution(normalised);
    if (accountEvolution) {
      return this.answerAccountEvolution(accountEvolution, context);
    }

    const accountSpend = this.matchAccountSpend(normalised);
    if (accountSpend) {
      return this.answerAccountSpend(accountSpend, context);
    }

    const accountBalance = this.matchAccountBalance(normalised);
    if (accountBalance) {
      return this.answerAccountBalance(accountBalance, context);
    }

    if (this.matchAnomaliesSummary(normalised)) {
      return this.answerAnomaliesSummary(context);
    }

    if (this.matchTopRisky(normalised)) {
      return this.answerTopRisky(context);
    }

    return this.unrecognised(question);
  }

  private async trySyscohadaKnowledge(
    question: string,
    normalised: string,
  ): Promise<AssistantAnswer | null> {
    if (!this.knowledge) return null;
    if (!this.isDoctrineQuestion(normalised)) return null;
    const domain = this.inferDomain(normalised);
    const answer = await this.knowledge.answerQuestion({ query: question, domain, limit: 3 });
    if (!answer) return null;
    return {
      answer: answer.answer,
      confidence: 85,
      matchedIntent: 'syscohada_knowledge',
      supportingData: { domain, citations: answer.citations },
    };
  }

  private isDoctrineQuestion(q: string): boolean {
    return /\b(syscohada|ohada|guide|doctrine|referentiel|audcif|dsf|bilan|tft|flux|note annexe|immobilisation|amortissement|stock|tva|location[ -]acquisition|credit[ -]bail|redevance|provision|subvention|retraite|indemnite de depart|avantages du personnel|fusion|apport|scission|effet de commerce|traite|escompte|endossement|devise|monnaie etrangere|ecart de conversion|garantie|gage|hypotheque|caution|nantissement|perte de valeur|valeur recouvrable|regularisation|rattachement|constat\w* d avance|charges a payer|produits a recevoir|rapprochement bancaire)\b/.test(
      q,
    );
  }

  private inferDomain(q: string): SyscohadaDomain {
    // Domaines métier spécifiques d'abord (mots-clés sans ambiguïté), puis les
    // domaines historiques. L'ordre garantit qu'une question sur un sujet
    // précis (location, fusion, devise…) n'est pas captée par une règle plus
    // générale, tout en conservant « TFT/flux → reports » (le TFT est un état
    // financier).
    if (
      /\b(location[ -]acquisition|location simple|credit[ -]bail|redevance|preneur|bailleur|bail)\b/.test(
        q,
      )
    )
      return 'leases';
    if (/\b(provision|risques et charges|litige|dotation aux provisions)\b/.test(q))
      return 'provisions';
    if (/\b(subvention)\b/.test(q)) return 'subsidies';
    if (
      /\b(retraite|indemnite de depart|indemnites de fin de carriere|avantages du personnel|engagement social)\b/.test(
        q,
      )
    )
      return 'actuarial-commitments';
    if (
      /\b(constat\w* d avance|charges a payer|produits a recevoir|regularisation|rattachement|abonnement)\b/.test(
        q,
      )
    )
      return 'regularizations';
    if (/\b(fusion|scission|apport partiel|absorption|transformation de societe)\b/.test(q))
      return 'business-combinations';
    if (
      /\b(effet de commerce|effets de commerce|traite|lettre de change|billet a ordre|escompte|endossement)\b/.test(
        q,
      )
    )
      return 'bills-of-exchange';
    if (
      /\b(devise|devises|monnaie etrangere|ecart de conversion|cours de change|operation en devise)\b/.test(
        q,
      )
    )
      return 'multi-currency';
    if (
      /\b(garantie|gage|hypotheque|caution|aval|nantissement|surete|engagement hors bilan)\b/.test(
        q,
      )
    )
      return 'pledged-assets';
    if (/\b(perte de valeur|valeur recouvrable|valeur actuelle|impairment)\b/.test(q))
      return 'impairments';
    if (
      /\b(previsionnel|prevision de tresorerie|budget de tresorerie|flux previsionnel|forecast)\b/.test(
        q,
      )
    )
      return 'cash-flow';
    if (/\b(rapprochement bancaire|etat de rapprochement)\b/.test(q)) return 'bank-reconciliation';
    if (/\b(bilan|resultat|tft|flux|dsf|note|annexe|etat financier)\b/.test(q)) return 'reports';
    if (/\b(immobilisation|amortissement|cession|depreciation)\b/.test(q)) return 'assets';
    if (/\b(stock|inventaire|cmp|fifo)\b/.test(q)) return 'inventory';
    if (/\b(tva|taxe|impot|fiscal)\b/.test(q)) return 'tva';
    if (/\b(journal|ecriture|lettrage|debit|credit)\b/.test(q)) return 'journals';
    if (/\b(compte|classe|plan comptable)\b/.test(q)) return 'accounting-plan';
    return 'ai';
  }

  // ─── Intent matchers (publics pour tests) ────────────────────────────

  matchAccountEvolution(q: string): { accountCode: string } | null {
    // "pourquoi le compte 6132 augmente ?" / "pourquoi 6132 monte"
    const m = q.match(
      /pourquoi.*?(?:compte\s+)?([1-9]\d{0,9}).*?(augmente|monte|diminue|baisse|evolue|change)/,
    );
    return m ? { accountCode: m[1] } : null;
  }

  matchAccountSpend(q: string): { accountCode: string } | null {
    // "combien j'ai depense en 6132" / "total compte 624" / "montant 60"
    const m = q.match(/(?:combien|total|montant|depense).*?(?:compte\s+)?([1-9]\d{0,9})/);
    return m ? { accountCode: m[1] } : null;
  }

  matchAccountBalance(q: string): { accountCode: string } | null {
    // "solde compte 411" / "balance 521"
    const m = q.match(/(?:solde|balance).*?(?:compte\s+)?([1-9]\d{0,9})/);
    return m ? { accountCode: m[1] } : null;
  }

  matchAnomaliesSummary(q: string): boolean {
    return /(quelles?\s+)?(anomalies?|risques?)\s+(detectees?|de la periode|en cours)?/.test(q);
  }

  matchTopRisky(q: string): boolean {
    return /(ecriture|entry|operation).*?(plus risqu|plus grave|score le plus haut)/.test(q);
  }

  // ─── Answer builders ────────────────────────────────────────────────

  private async answerAccountEvolution(
    args: { accountCode: string },
    ctx: AssistantContext,
  ): Promise<AssistantAnswer> {
    // Compare le total débit-crédit des 30 derniers jours vs les 30 jours
    // précédents pour les comptes commençant par `accountCode`.
    const rows = await this.dataSource.query<
      Array<{
        period: 'current' | 'previous';
        total_debit: string;
        total_credit: string;
        entry_count: string;
      }>
    >(
      `SELECT
         CASE WHEN e.entry_date >= CURRENT_DATE - INTERVAL '30 days' THEN 'current' ELSE 'previous' END AS period,
         COALESCE(SUM(l.debit),  0)::text  AS total_debit,
         COALESCE(SUM(l.credit), 0)::text  AS total_credit,
         COUNT(DISTINCT e.id)::text         AS entry_count
       FROM journal_entry_lines l
       JOIN journal_entries e             ON e.id = l.journal_entry_id
       JOIN organization_chart_accounts a ON a.id = l.account_id
       WHERE l.organization_id = $1
         AND e.status = 'validated'
         AND a.code LIKE $2 || '%'
         AND e.entry_date >= CURRENT_DATE - INTERVAL '60 days'
       GROUP BY period`,
      [ctx.organizationId, args.accountCode],
    );

    const current = rows.find((r) => r.period === 'current');
    const previous = rows.find((r) => r.period === 'previous');
    const curNet = current ? Number(current.total_debit) - Number(current.total_credit) : 0;
    const prevNet = previous ? Number(previous.total_debit) - Number(previous.total_credit) : 0;
    const delta = curNet - prevNet;
    const direction = delta > 0 ? 'augmenté' : delta < 0 ? 'diminué' : 'stable';

    return {
      answer:
        `Sur les 30 derniers jours, le solde net du compte ${args.accountCode}* a ${direction} ` +
        `de ${this.fmtAmount(Math.abs(delta))} XOF par rapport aux 30 jours précédents ` +
        `(${current?.entry_count ?? 0} écriture${current && Number(current.entry_count) > 1 ? 's' : ''} sur la période courante).`,
      confidence: 75,
      matchedIntent: 'account_evolution',
      supportingData: {
        accountPrefix: args.accountCode,
        currentNet: curNet,
        previousNet: prevNet,
        delta,
      },
    };
  }

  private async answerAccountSpend(
    args: { accountCode: string },
    ctx: AssistantContext,
  ): Promise<AssistantAnswer> {
    const rows = await this.dataSource.query<Array<{ total_debit: string; entry_count: string }>>(
      `SELECT
         COALESCE(SUM(l.debit), 0)::text AS total_debit,
         COUNT(DISTINCT e.id)::text       AS entry_count
       FROM journal_entry_lines l
       JOIN journal_entries e             ON e.id = l.journal_entry_id
       JOIN organization_chart_accounts a ON a.id = l.account_id
       WHERE l.organization_id = $1
         AND e.status = 'validated'
         AND a.code LIKE $2 || '%'`,
      [ctx.organizationId, args.accountCode],
    );
    const row = rows[0];
    const total = row ? Number(row.total_debit) : 0;
    const count = row ? Number(row.entry_count) : 0;
    return {
      answer: `Total débité sur le compte ${args.accountCode}* : ${this.fmtAmount(total)} XOF (${count} écriture${count > 1 ? 's' : ''} validée${count > 1 ? 's' : ''}).`,
      confidence: 80,
      matchedIntent: 'account_spend',
      supportingData: { accountPrefix: args.accountCode, totalDebit: total, entryCount: count },
    };
  }

  private async answerAccountBalance(
    args: { accountCode: string },
    ctx: AssistantContext,
  ): Promise<AssistantAnswer> {
    const rows = await this.dataSource.query<Array<{ debit: string; credit: string }>>(
      `SELECT
         COALESCE(SUM(l.debit), 0)::text  AS debit,
         COALESCE(SUM(l.credit), 0)::text AS credit
       FROM journal_entry_lines l
       JOIN journal_entries e             ON e.id = l.journal_entry_id
       JOIN organization_chart_accounts a ON a.id = l.account_id
       WHERE l.organization_id = $1
         AND e.status = 'validated'
         AND a.code LIKE $2 || '%'`,
      [ctx.organizationId, args.accountCode],
    );
    const row = rows[0];
    const debit = row ? Number(row.debit) : 0;
    const credit = row ? Number(row.credit) : 0;
    const net = debit - credit;
    const sens = net > 0 ? 'débiteur' : net < 0 ? 'créditeur' : 'équilibré';
    return {
      answer: `Solde du compte ${args.accountCode}* : ${this.fmtAmount(Math.abs(net))} XOF (${sens}) — total débit ${this.fmtAmount(debit)}, total crédit ${this.fmtAmount(credit)}.`,
      confidence: 80,
      matchedIntent: 'account_balance',
      supportingData: { accountPrefix: args.accountCode, debit, credit, net },
    };
  }

  private async answerAnomaliesSummary(ctx: AssistantContext): Promise<AssistantAnswer> {
    const params: Array<string> = [ctx.organizationId];
    let periodClause = '';
    if (ctx.periodId) {
      periodClause = ' AND period_id = $2';
      params.push(ctx.periodId);
    }
    const rows = await this.dataSource.query<
      Array<{ anomaly_type: string; n: string; avg_score: string }>
    >(
      `SELECT anomaly_type,
              COUNT(*)::text AS n,
              ROUND(AVG(risk_score))::text AS avg_score
       FROM ai_anomalies
       WHERE organization_id = $1${periodClause}
         AND risk_score >= 50
       GROUP BY anomaly_type
       ORDER BY n DESC`,
      params,
    );
    if (rows.length === 0) {
      return {
        answer: 'Aucune anomalie au-dessus du seuil 50/100 pour le périmètre demandé.',
        confidence: 80,
        matchedIntent: 'anomalies_summary',
        supportingData: { total: 0, byType: [] },
      };
    }
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    const summary = rows
      .map((r) => `${r.n} ${this.typeLabel(r.anomaly_type)} (score moyen ${r.avg_score})`)
      .join(', ');
    return {
      answer: `${total} anomalie${total > 1 ? 's' : ''} ≥ 50/100 détectée${total > 1 ? 's' : ''} : ${summary}.`,
      confidence: 80,
      matchedIntent: 'anomalies_summary',
      supportingData: { total, byType: rows },
    };
  }

  private async answerTopRisky(ctx: AssistantContext): Promise<AssistantAnswer> {
    const rows = await this.dataSource.query<
      Array<{
        anomaly_type: string;
        risk_score: string;
        reasons: string[];
        entry_id: string | null;
        account_id: string | null;
      }>
    >(
      `SELECT anomaly_type, risk_score::text, reasons, entry_id, account_id
       FROM ai_anomalies
       WHERE organization_id = $1
       ORDER BY risk_score DESC, detected_at DESC
       LIMIT 1`,
      [ctx.organizationId],
    );
    if (rows.length === 0) {
      return {
        answer: 'Aucune anomalie en base. Lancez un scan via le bouton "Scanner" sur la page IA.',
        confidence: 80,
        matchedIntent: 'top_risky',
      };
    }
    const top = rows[0];
    return {
      answer: `Écriture la plus risquée : ${this.typeLabel(top.anomaly_type)}, score ${top.risk_score}/100. Raisons : ${(top.reasons ?? []).join(' | ')}.`,
      confidence: 80,
      matchedIntent: 'top_risky',
      supportingData: {
        entryId: top.entry_id,
        accountId: top.account_id,
        riskScore: Number(top.risk_score),
      },
    };
  }

  private unrecognised(question: string): AssistantAnswer {
    return {
      answer:
        `Je n'ai pas reconnu votre question : "${question.slice(0, 100)}". ` +
        `Le provider heuristique wave 2 couvre 5 patterns : évolution d'un compte, total dépensé, solde, ` +
        `résumé d'anomalies, écriture la plus risquée. Un LLM est prévu en wave 3.`,
      confidence: 0,
      matchedIntent: null,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private normalise(s: string): string {
    return (
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        // Ponctuation et apostrophes (droites/typographiques) → espace, pour que
        // « d'avance », « location-acquisition » matchent les motifs métier.
        .replace(/[?!.,;:'’\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  private fmtAmount(n: number): string {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
  }

  private typeLabel(t: string): string {
    switch (t) {
      case 'extreme_amount':
        return 'montant extrême';
      case 'sensitive_account':
        return 'compte sensible';
      case 'potential_duplicate':
        return 'doublon potentiel';
      case 'suspicious_date':
        return 'date suspecte';
      case 'rare_account_journal':
        return 'combinaison rare';
      default:
        return t;
    }
  }
}
