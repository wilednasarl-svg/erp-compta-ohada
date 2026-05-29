import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TvaDeclarationEntity } from '../../tva/entities/tva-declaration.entity';
import { MembershipEntity } from '../../rbac/entities/membership.entity';
import type { TvaDeclarationStatus } from '../../tva/types/tva.types';
import { EmailService } from './email.service';

interface DeadlineInfo {
  readonly daysUntil: number;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly deadlineDate: string;
}

interface ReminderContext {
  readonly orgName: string;
  readonly period: string;
  readonly deadlineDate: string;
  readonly daysUntil: number;
  readonly status: TvaDeclarationStatus;
  readonly tvaADecaisser: string;
}

const NOTIFIABLE_STATUSES: ReadonlyArray<TvaDeclarationStatus> = ['draft', 'calculated'];

/**
 * Envoie des rappels email J-7 et J-1 avant l'échéance TVA mensuelle.
 *
 * En régime RNI UEMOA (Côte d'Ivoire, art. 411 CGI), la déclaration
 * mensuelle TVA est due le 15 du mois suivant la période. Ce service
 * vérifie chaque matin à 7h00 UTC si une organisation a une déclaration
 * en statut `draft` ou `calculated` dont l'échéance approche, et notifie
 * tous ses membres actifs.
 */
@Injectable()
export class TvaNotificationService {
  private readonly logger = new Logger(TvaNotificationService.name);

  constructor(
    @InjectRepository(TvaDeclarationEntity)
    private readonly tvaRepo: Repository<TvaDeclarationEntity>,
    @InjectRepository(MembershipEntity)
    private readonly membershipRepo: Repository<MembershipEntity>,
    private readonly emailService: EmailService,
  ) {}

  /** Abidjan = UTC+0 — 7h00 UTC est 7h00 heure locale. */
  @Cron('0 7 * * *', { name: 'tva-deadline-check' })
  async checkTvaDeadlines(): Promise<void> {
    const info = this.computeDeadlineInfo(new Date());
    if (info === null) return;

    const { daysUntil, periodYear, periodMonth, deadlineDate } = info;
    const label = `${String(periodMonth).padStart(2, '0')}/${periodYear}`;

    const declarations = await this.tvaRepo.find({
      where: { periodYear, periodMonth, status: In([...NOTIFIABLE_STATUSES]) },
      relations: { organization: true },
    });

    if (declarations.length === 0) {
      this.logger.log(`[TVA] J-${daysUntil} — aucune déclaration à notifier pour ${label}`);
      return;
    }

    this.logger.log(
      `[TVA] J-${daysUntil} — ${declarations.length} déclaration(s) période ${label} à notifier`,
    );

    await Promise.allSettled(
      declarations.map((d) => this.notifyOrganization(d, daysUntil, deadlineDate)),
    );
  }

  private async notifyOrganization(
    declaration: TvaDeclarationEntity,
    daysUntil: number,
    deadlineDate: string,
  ): Promise<void> {
    const memberships = await this.membershipRepo.find({
      where: { organizationId: declaration.organizationId, status: 'active' },
      relations: { user: true },
    });

    const emails = memberships
      .map((m) => m.user?.email)
      .filter((e): e is string => typeof e === 'string' && e.length > 0);

    if (emails.length === 0) return;

    const orgName = declaration.organization?.name ?? declaration.organizationId;

    const ctx: ReminderContext = {
      orgName,
      period: `${String(declaration.periodMonth).padStart(2, '0')}/${declaration.periodYear}`,
      deadlineDate,
      daysUntil,
      status: declaration.status,
      tvaADecaisser: new Intl.NumberFormat('fr-FR').format(
        parseFloat(declaration.tvaADecaisser ?? '0'),
      ),
    };

    const subject =
      daysUntil === 1
        ? `⚠️ URGENT — Déclaration TVA ${ctx.period} à déposer demain (${orgName})`
        : `Rappel — TVA ${ctx.period} : échéance dans ${daysUntil} jours (${orgName})`;

    await this.emailService.sendMail({
      to: emails,
      subject,
      text: renderReminderText(ctx),
      html: renderReminderHtml(ctx),
    });

    this.logger.log(
      `[TVA] Notification J-${daysUntil} envoyée — org="${orgName}" période="${ctx.period}" destinataires=${emails.length}`,
    );
  }

  /**
   * Retourne les informations de l'échéance TVA à vérifier aujourd'hui,
   * ou `null` si aucun rappel n'est dû (on ne notifie qu'à J-7 et J-1).
   *
   * Logique UEMOA : échéance = 15 du mois M+1 pour la période M.
   * - Si today < 15 → échéance = 15 du mois courant → période = mois précédent
   * - Si today ≥ 15 → échéance = 15 du mois suivant → période = mois courant
   */
  computeDeadlineInfo(today: Date): DeadlineInfo | null {
    const day = today.getDate();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();

    const deadlineMonth = day < 15 ? month : month === 12 ? 1 : month + 1;
    const deadlineYear = day < 15 ? year : month === 12 ? year + 1 : year;

    const deadline = new Date(deadlineYear, deadlineMonth - 1, 15);
    const todayMidnight = new Date(year, month - 1, day);
    const daysUntil = Math.round(
      (deadline.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntil !== 7 && daysUntil !== 1) return null;

    const periodMonth = deadlineMonth === 1 ? 12 : deadlineMonth - 1;
    const periodYear = deadlineMonth === 1 ? deadlineYear - 1 : deadlineYear;
    const deadlineDate = `15/${String(deadlineMonth).padStart(2, '0')}/${deadlineYear}`;

    return { daysUntil, periodYear, periodMonth, deadlineDate };
  }
}

/* ─── Email rendering ──────────────────────────────────────────── */

function renderReminderText(ctx: ReminderContext): string {
  const statusLabel =
    ctx.status === 'calculated'
      ? `Calculée — TVA à décaisser : ${ctx.tvaADecaisser} FCFA`
      : 'Non encore calculée — veuillez lancer le calcul dans ERP Compta';

  return [
    `Bonjour,`,
    ``,
    `RAPPEL TVA — ${ctx.orgName}`,
    ``,
    `La déclaration TVA du mois ${ctx.period} arrive à échéance le ${ctx.deadlineDate}.`,
    `Il reste ${ctx.daysUntil} jour${ctx.daysUntil > 1 ? 's' : ''}.`,
    ``,
    `État : ${statusLabel}`,
    ``,
    ctx.daysUntil === 1
      ? `⚠️  Dernier jour — déposez votre déclaration avant la fermeture des services DGI.`
      : `Connectez-vous à ERP Compta pour finaliser et soumettre votre déclaration.`,
    ``,
    `— ERP Compta OHADA`,
  ].join('\n');
}

function renderReminderHtml(ctx: ReminderContext): string {
  const isUrgent = ctx.daysUntil === 1;
  const bannerBg = isUrgent ? '#fff3cd' : '#eef2ff';
  const bannerBorder = isUrgent ? '#f59e0b' : '#4f46e5';
  const bannerText = isUrgent
    ? `<strong style="color:#92400e;">⚠️ URGENT — Dernier jour pour déposer</strong>`
    : `<strong style="color:#312e81;">Rappel TVA — J-${ctx.daysUntil}</strong>`;

  const statusCell =
    ctx.status === 'calculated'
      ? `Calculée — TVA à décaisser : <strong>${escapeHtml(ctx.tvaADecaisser)} FCFA</strong>`
      : `<span style="color:#dc2626;">Non calculée — veuillez lancer le calcul</span>`;

  return [
    `<!doctype html>`,
    `<html lang="fr"><body style="font-family:-apple-system,system-ui,sans-serif;color:#111;max-width:540px;margin:24px auto;padding:0 16px;">`,
    `<div style="border-left:4px solid ${bannerBorder};background:${bannerBg};padding:10px 14px;margin-bottom:20px;border-radius:4px;">${bannerText}</div>`,
    `<h2 style="margin:0 0 6px;font-size:20px;">Déclaration TVA ${escapeHtml(ctx.period)}</h2>`,
    `<p style="margin:0 0 18px;color:#555;font-size:14px;">Organisation : <strong>${escapeHtml(ctx.orgName)}</strong></p>`,
    `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:22px;">`,
    tableRow('Période', escapeHtml(ctx.period)),
    tableRow('Échéance DGI', escapeHtml(ctx.deadlineDate)),
    tableRow(
      'Jours restants',
      `<strong>${ctx.daysUntil} jour${ctx.daysUntil > 1 ? 's' : ''}</strong>`,
    ),
    tableRow('État', statusCell, true),
    `</table>`,
    `<p style="margin:0 0 24px;">`,
    `  <a href="#" style="background:#166534;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;display:inline-block;">`,
    `    Accéder à la déclaration TVA →`,
    `  </a>`,
    `</p>`,
    `<p style="font-size:11px;color:#999;border-top:1px solid #e5e7eb;padding-top:12px;margin:0;">`,
    `  Envoi automatique — ERP Compta OHADA. En régime RNI, la déclaration mensuelle TVA est due`,
    `  le 15 du mois suivant (CGI Côte d'Ivoire, art. 411).`,
    `</p>`,
    `</body></html>`,
  ].join('\n');
}

function tableRow(label: string, value: string, isLast = false): string {
  const border = isLast ? '' : 'border-bottom:1px solid #e5e7eb;';
  return [
    `<tr>`,
    `  <td style="padding:8px 0;${border}color:#6b7280;width:40%;">${label}</td>`,
    `  <td style="padding:8px 0;${border}">${value}</td>`,
    `</tr>`,
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
