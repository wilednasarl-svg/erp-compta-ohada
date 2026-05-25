import { Injectable, Logger } from '@nestjs/common';

import { asTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import { UserRepository } from '../../auth/repositories/user.repository';
import { EmailService } from '../../email/services/email.service';
import { OrganizationRepository } from '../../organizations/repositories/organization.repository';
import { MembershipRepository } from '../../rbac/repositories/membership.repository';
import { RoleRepository } from '../../rbac/repositories/role.repository';
import { AccountingPeriodRepository } from '../repositories/accounting-period.repository';
import { EntrySignatureRepository } from '../repositories/entry-signature.repository';
import { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';
import { JournalEntryRepository } from '../repositories/journal-entry.repository';
import { JournalRepository } from '../repositories/journal.repository';
import { EntryPdfGenerator, buildVerifyUrl } from './entry-pdf-generator';

/**
 * `EntryNotificationService` — wave 2 Module 14.
 *
 * Sends transactional notifications on every workflow transition and
 * delivers the signed PDF on final signature. Designed to be
 * fire-and-forget: every public method wraps its IO in a try/catch and
 * logs at WARN on failure so a transient SMTP or repo blip never
 * cascades back into a 4xx/5xx for the upstream workflow request.
 *
 * Recipient resolution walks `memberships → roles → users`:
 *   - "chef de mission" inbox  → role code `chef_mission`
 *   - "expert-comptable" inbox → role code `expert_comptable`
 *   - "creator" inbox          → `journal_entries.created_by_id`
 *
 * If recipient resolution returns an empty set (org not staffed yet),
 * the notification is silently skipped — the workflow row + audit
 * trail still carry the transition.
 */
@Injectable()
export class EntryNotificationService {
  private readonly logger = new Logger(EntryNotificationService.name);

  constructor(
    private readonly email: EmailService,
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    private readonly orgs: OrganizationRepository,
    private readonly entryRepo: JournalEntryRepository,
    private readonly lineRepo: JournalEntryLineRepository,
    private readonly signatures: EntrySignatureRepository,
    private readonly journals: JournalRepository,
    private readonly periods: AccountingPeriodRepository,
    private readonly accounts: OrganizationAccountRepository,
    private readonly pdf: EntryPdfGenerator,
  ) {}

  async notifySubmittedForReview(
    entryId: string,
    organizationId: TenantId | string,
    _ctx: AuditContext,
  ): Promise<void> {
    await this.safe('notifySubmittedForReview', async () => {
      const recipients = await this.listEmailsForRole(organizationId, 'chef_mission');
      if (recipients.length === 0) return;
      const entry = await this.entryRepo.findById(entryId, organizationId);
      if (!entry) return;
      const subject = `[Compta] Écriture #${entry.entryNumber} à revoir`;
      const text =
        `Bonjour,\n\n` +
        `Une écriture comptable est en attente de votre revue :\n` +
        `  • N° ${entry.entryNumber}\n` +
        `  • Date ${entry.entryDate}\n` +
        `  • Description : ${entry.description}\n\n` +
        `Merci de vous connecter pour la traiter.\n\n— ERP Compta`;
      await this.email.sendMail({ to: recipients, subject, text });
    });
  }

  async notifyApproved(
    entryId: string,
    organizationId: TenantId | string,
    _ctx: AuditContext,
  ): Promise<void> {
    await this.safe('notifyApproved', async () => {
      const recipients = await this.listEmailsForRole(organizationId, 'expert_comptable');
      if (recipients.length === 0) return;
      const entry = await this.entryRepo.findById(entryId, organizationId);
      if (!entry) return;
      const subject = `[Compta] Écriture #${entry.entryNumber} prête pour signature`;
      const text =
        `Bonjour,\n\n` +
        `Une écriture a été approuvée par le chef de mission et attend votre signature finale :\n` +
        `  • N° ${entry.entryNumber}\n` +
        `  • Date ${entry.entryDate}\n` +
        `  • Description : ${entry.description}\n\n` +
        `— ERP Compta`;
      await this.email.sendMail({ to: recipients, subject, text });
    });
  }

  async notifySigned(
    entryId: string,
    organizationId: TenantId | string,
    _ctx: AuditContext,
  ): Promise<void> {
    await this.safe('notifySigned', async () => {
      const entry = await this.entryRepo.findById(entryId, organizationId);
      if (!entry || entry.createdById === null) return;
      const creator = await this.users.findActiveById(entry.createdById);
      if (!creator) return;

      // Assemble the PDF input from the existing repositories. Each call
      // is bounded to a single entry so the I/O footprint is small.
      const tenant = asTenantId(organizationId);
      const [lines, sigs, journal, period, organization, allAccounts] = await Promise.all([
        this.lineRepo.listByEntry(entry.id),
        this.signatures.listByEntry(tenant, entry.id),
        this.journals.findById(entry.journalId, tenant),
        this.periods.findById(entry.periodId, tenant),
        this.orgs.findActiveById(tenant),
        this.accounts.listByOrganization(tenant),
      ]);
      if (journal === null || period === null || organization === null) {
        this.logger.warn(
          `notifySigned: skip PDF — missing journal/period/org for entry ${entry.id}`,
        );
        return;
      }
      const accountsById = new Map(allAccounts.map((a) => [a.id, a]));

      const expertSig = sigs.find((s) => s.signerRole === 'expert_comptable');
      if (!expertSig) {
        // Shouldn't happen — sign() is the only caller; but be defensive.
        this.logger.warn(`notifySigned: no expert signature for entry ${entry.id}`);
        return;
      }

      const buffer = await this.pdf.generate({
        entry,
        lines,
        accountsById,
        signatures: sigs,
        journal,
        period,
        organization,
        verificationSignatureId: expertSig.id,
      });

      const subject = `[Compta] Écriture #${entry.entryNumber} signée et archivée`;
      const verifyUrl = buildVerifyUrl(expertSig.id);
      const text =
        `Bonjour,\n\n` +
        `Votre écriture #${entry.entryNumber} a été signée par l'expert-comptable et est désormais validée.\n` +
        `Le PDF signé est joint à ce message.\n\n` +
        `Vérification publique de la signature : ${verifyUrl}\n\n— ERP Compta`;
      await this.email.sendMail({
        to: creator.email,
        subject,
        text,
        attachments: [
          {
            filename: `ecriture-${journal.code}-${entry.entryNumber}.pdf`,
            content: buffer,
            contentType: 'application/pdf',
          },
        ],
      });
    });
  }

  async notifyRejected(
    entryId: string,
    organizationId: TenantId | string,
    reason: string,
    _ctx: AuditContext,
  ): Promise<void> {
    await this.safe('notifyRejected', async () => {
      const entry = await this.entryRepo.findById(entryId, organizationId);
      if (!entry || entry.createdById === null) return;
      const creator = await this.users.findActiveById(entry.createdById);
      if (!creator) return;
      const subject = `[Compta] Écriture #${entry.entryNumber} rejetée`;
      const text =
        `Bonjour,\n\n` +
        `Votre écriture comptable #${entry.entryNumber} a été rejetée.\n` +
        `Motif : ${reason}\n\n` +
        `Merci de la corriger puis de la resoumettre.\n\n— ERP Compta`;
      await this.email.sendMail({ to: creator.email, subject, text });
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private async listEmailsForRole(
    organizationId: TenantId | string,
    roleCode: 'chef_mission' | 'expert_comptable',
  ): Promise<string[]> {
    const role = await this.roles.findByCode(roleCode);
    if (role === null) return [];
    const members = await this.memberships.listActiveByOrganizationWithRelations(organizationId);
    const emails: string[] = [];
    for (const m of members) {
      if (m.roleId !== role.id) continue;
      if (m.user?.email) {
        emails.push(m.user.email);
      }
    }
    return emails;
  }

  private async safe(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`${label} failed (non-fatal): ${msg}`);
    }
  }
}
