import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
 * `EmailService` (BE-MAIL-01) — outbound email surface.
 *
 * MVP shipment is a single concrete class that **honors the
 * `EMAIL_DRY_RUN` env flag**: when truthy, every send is logged at INFO
 * level instead of touching SMTP. The dry-run path keeps local /
 * staging environments runnable without credentials and makes
 * integration tests deterministic without a mail-server fixture.
 *
 * The real SMTP path (`nodemailer`-backed) will land in a follow-up
 * (BE-MAIL-02). Keeping the surface as one class for now avoids over-
 * engineering an interface that has a single producer.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly dryRun: boolean;
  private readonly from: string;
  private readonly appBaseUrl: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    const email = configService.get('email', { infer: true });
    const smtp = configService.get('smtp', { infer: true });
    this.dryRun = email.dryRun;
    this.from = smtp.from;
    this.appBaseUrl = configService.get('appBaseUrl', { infer: true });
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

  // The body is synchronous today (log-only), but the public API stays
  // `Promise<void>` so the SMTP swap-in (BE-MAIL-02) can land without
  // touching call sites. The disable mirrors the rationale on
  // `EncryptionService.encrypt` / `decrypt`.
  // eslint-disable-next-line @typescript-eslint/require-await
  async sendInvitationEmail(input: InvitationEmailInput): Promise<void> {
    if (this.dryRun) {
      this.logger.log(
        `[DRY-RUN] invitation email skipped — to="${input.to}" org="${input.organizationName}" inviter="${input.inviterName ?? 'unknown'}" role="${input.roleCode}" acceptUrl="${input.acceptUrl}"`,
      );
      return;
    }
    // Real SMTP send lands in BE-MAIL-02 (nodemailer). Failing closed
    // here would block invitation creation in environments that haven't
    // wired SMTP yet; failing soft (log + return) keeps the API call
    // succeeding while observably warning the operator.
    this.logger.warn(
      `sendInvitationEmail: no SMTP transport wired (BE-MAIL-02). Would have sent to="${input.to}" from="${this.from}".`,
    );
  }
}
