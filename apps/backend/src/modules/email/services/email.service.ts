import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

import type { AppConfig } from '../../../config/configuration';

/**
 * Input shape consumed by the invitation flow (BE-INV-01). Kept as a
 * dedicated interface so the wire shape of the email layer is explicit
 * and a real SMTP implementation can swap in without controllers
 * touching `nodemailer`.
 */
export interface InvitationEmailInput {
  readonly to: string;
  readonly organizationName: string;
  readonly inviterName: string | null;
  readonly roleCode: string;
  /** Full URL the invitee opens to call `POST /auth/invitations/accept`. */
  readonly acceptUrl: string;
}

/**
 * Minimal transport surface we depend on. Typing this explicitly (instead
 * of leaking the full `nodemailer.Transporter` shape) keeps the test
 * doubles trivial — a simple `{ sendMail: jest.fn() }` satisfies the
 * contract — and lets us swap in an alternate backend (Postmark SDK,
 * SES, …) without touching call sites.
 */
type MailTransport = Pick<Transporter, 'sendMail'>;

/**
 * `EmailService` (BE-MAIL-01 + BE-MAIL-02) — outbound email surface.
 *
 *   - **DRY-RUN branch** (`EMAIL_DRY_RUN=true`): every send is logged
 *     at INFO and `sendMail` is never called. Keeps local/staging
 *     environments runnable without SMTP credentials, and integration
 *     tests deterministic without a mail-server fixture.
 *
 *   - **SMTP branch** (`EMAIL_DRY_RUN=false`): a `nodemailer`
 *     transporter is created once at construction from the validated
 *     `SMTP_*` env vars and reused for every send. Both an HTML body
 *     and a plain-text fallback are produced inline (no templating
 *     engine — keeps deps light for MVP; a future hardening pass can
 *     swap in MJML / handlebars without touching the public API).
 *
 * Failures from `sendMail` (SMTP timeout, auth rejection, DNS error)
 * are logged at ERROR but NOT re-thrown: the audit + DB row for the
 * triggering invitation is already committed when this method runs, so
 * a transient SMTP outage must not cascade into a 5xx for the caller.
 * The operator sees the failure in logs and resends manually via the
 * admin invitations endpoint.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly dryRun: boolean;
  private readonly from: string;
  private readonly appBaseUrl: string;
  private readonly transport: MailTransport | null;

  constructor(
    configService: ConfigService<AppConfig, true>,
    /**
     * Optional injection point used by unit tests to feed a
     * `{ sendMail: jest.fn() }` mock. Production callers pass nothing
     * and let the constructor build a real `nodemailer` transport from
     * `SMTP_*` env vars (skipped in dry-run mode to avoid a needless
     * DNS / connection attempt).
     */
    @Optional() transportOverride?: MailTransport,
  ) {
    const email = configService.get('email', { infer: true });
    const smtp = configService.get('smtp', { infer: true });
    this.dryRun = email.dryRun;
    this.from = smtp.from;
    this.appBaseUrl = configService.get('appBaseUrl', { infer: true });

    if (transportOverride !== undefined) {
      this.transport = transportOverride;
    } else if (this.dryRun) {
      this.transport = null;
    } else {
      this.transport = createTransport({
        host: smtp.host,
        port: smtp.port,
        // Most managed SMTP providers (SES, Mailgun, Postmark, Sendgrid)
        // use STARTTLS on port 587 (`secure: false`) or implicit TLS on
        // 465 (`secure: true`). We pick the convention based on the
        // port so the operator only has to set one variable.
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
      });
    }
  }

  /**
   * Build the canonical accept URL `${APP_BASE_URL}/accept-invitation?token=…`.
   * Centralized so the spec link format (`specs/organizations/spec.md`:
   * "Lien email `https://app/accept-invitation?token=<token>`") lives in
   * one place.
   */
  buildAcceptInvitationUrl(token: string): string {
    const base = this.appBaseUrl.replace(/\/+$/u, '');
    return `${base}/accept-invitation?token=${encodeURIComponent(token)}`;
  }

  /**
   * Generic outbound send — used by callers (Module 14 workflow
   * notifications, signed PDF delivery) that need attachments or a
   * subject that doesn't fit the invitation template. Honours the same
   * dry-run / SMTP-failure semantics as `sendInvitationEmail`: failures
   * are logged at ERROR and swallowed so the upstream business
   * operation is not rolled back by a transient mail outage. The
   * caller owns subject/body rendering and attachment sizing.
   */
  async sendMail(input: {
    readonly to: string | string[];
    readonly subject: string;
    readonly text: string;
    readonly html?: string;
    readonly attachments?: ReadonlyArray<{
      filename: string;
      content: Buffer;
      contentType?: string;
    }>;
  }): Promise<void> {
    const recipients = Array.isArray(input.to) ? input.to.join(',') : input.to;
    if (this.dryRun || this.transport === null) {
      this.logger.log(
        `[DRY-RUN] mail skipped — to="${recipients}" subject="${input.subject}" attachments=${
          input.attachments?.length ?? 0
        }`,
      );
      return;
    }
    try {
      await this.transport.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `sendMail: SMTP send failed — to="${recipients}" subject="${input.subject}" reason="${message}"`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async sendInvitationEmail(input: InvitationEmailInput): Promise<void> {
    if (this.dryRun || this.transport === null) {
      this.logger.log(
        `[DRY-RUN] invitation email skipped — to="${input.to}" org="${input.organizationName}" inviter="${input.inviterName ?? 'unknown'}" role="${input.roleCode}" acceptUrl="${input.acceptUrl}"`,
      );
      return;
    }

    const { html, text, subject } = renderInvitationBody(input);

    try {
      await this.transport.sendMail({
        from: this.from,
        to: input.to,
        subject,
        text,
        html,
      });
    } catch (error: unknown) {
      // SMTP failures must NOT cascade into a 5xx for the inviter — the
      // DB row + audit are already committed. The operator triages from
      // logs and resends via the admin invitations endpoint.
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `sendInvitationEmail: SMTP send failed — to="${input.to}" reason="${message}"`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

/**
 * Render the invitation email body. Inline strings on purpose — for
 * MVP scope, a templating engine (MJML, handlebars) would be over-
 * engineering. The output is intentionally minimal: plain-text fallback
 * for clients that strip HTML, single-table HTML for clients that
 * render it. Both contain the accept URL so the invitee can complete
 * the flow regardless of their email client's capabilities.
 *
 * `escapeHtml` keeps the user-supplied fields (`organizationName`,
 * `inviterName`) safe from injection — even though only an
 * `organizations.invite` admin can trigger this code path, defensive
 * escaping costs nothing and forecloses a stored-XSS chain via a
 * hypothetical future webview rendering of the email body.
 */
function renderInvitationBody(input: InvitationEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const inviter = input.inviterName ?? 'A team member';
  const subject = `${inviter} invited you to ${input.organizationName} on ERP Compta`;
  const text = [
    `Hello,`,
    ``,
    `${inviter} has invited you to join "${input.organizationName}" as ${input.roleCode} on ERP Compta.`,
    ``,
    `Open this link to accept the invitation:`,
    input.acceptUrl,
    ``,
    `The link expires in 7 days.`,
    `If you did not expect this invitation, you can safely ignore this email.`,
    ``,
    `— ERP Compta`,
  ].join('\n');
  const html = [
    `<!doctype html>`,
    `<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a1a; max-width: 560px; margin: 24px auto; padding: 0 16px;">`,
    `<h2 style="margin: 0 0 16px;">You're invited to ${escapeHtml(input.organizationName)}</h2>`,
    `<p>${escapeHtml(inviter)} has invited you to join <strong>${escapeHtml(input.organizationName)}</strong> as <code>${escapeHtml(input.roleCode)}</code> on ERP Compta.</p>`,
    `<p style="margin: 24px 0;"><a href="${escapeHtml(input.acceptUrl)}" style="background:#1a73e8;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;display:inline-block;">Accept invitation</a></p>`,
    `<p style="font-size: 13px; color: #555;">Or open this link directly: <br><a href="${escapeHtml(input.acceptUrl)}">${escapeHtml(input.acceptUrl)}</a></p>`,
    `<p style="font-size: 13px; color: #555;">The link expires in 7 days. If you did not expect this invitation, you can safely ignore this email.</p>`,
    `<p style="font-size: 12px; color: #888; margin-top: 32px;">— ERP Compta</p>`,
    `</body></html>`,
  ].join('');
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      // Backtick is benign in standard HTML attribute contexts but some
      // older IE versions treated it as an attribute delimiter. Cheap
      // belt-and-braces — keeps the escape list complete enough for any
      // future template growth (e.g. inline JS).
      .replace(/`/g, '&#96;')
  );
}
