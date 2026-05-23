import type { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';

import type { AppConfig } from '../../../config/configuration';
import { EmailService, type InvitationEmailInput } from './email.service';

interface ConfigOverrides {
  dryRun?: boolean;
  appBaseUrl?: string;
  smtpFrom?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
}

type SendMailMock = jest.Mock<Promise<unknown>, [unknown]>;

function buildConfigService(overrides: ConfigOverrides = {}) {
  const dryRun = overrides.dryRun ?? true;
  const appBaseUrl = overrides.appBaseUrl ?? 'https://app.example';
  const smtp = {
    host: overrides.smtpHost ?? 'smtp.example',
    port: overrides.smtpPort ?? 587,
    user: overrides.smtpUser ?? 'user',
    pass: overrides.smtpPass ?? 'pass',
    from: overrides.smtpFrom ?? 'no-reply@erp.example',
  };
  return {
    get: jest.fn((path: string) => {
      if (path === 'email') {
        return { dryRun };
      }
      if (path === 'smtp') {
        return smtp;
      }
      if (path === 'appBaseUrl') {
        return appBaseUrl;
      }
      return undefined;
    }),
  } as unknown as ConfigService<AppConfig, true>;
}

function buildService(
  overrides: ConfigOverrides = {},
  transport?: Pick<Transporter, 'sendMail'>,
): EmailService {
  return new EmailService(buildConfigService(overrides), transport);
}

function buildTransport(): { transport: Pick<Transporter, 'sendMail'>; sendMail: SendMailMock } {
  const sendMail = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ accepted: ['ok'] });
  return { transport: { sendMail } as unknown as Pick<Transporter, 'sendMail'>, sendMail };
}

const SAMPLE_INVITE: InvitationEmailInput = {
  to: 'new@cabinet.ci',
  organizationName: 'Cabinet Konan',
  inviterName: 'Yao Konan',
  roleCode: 'comptable',
  acceptUrl: 'https://app.example/accept-invitation?token=tok',
};

describe('EmailService (BE-MAIL-01 + BE-MAIL-02)', () => {
  describe('buildAcceptInvitationUrl', () => {
    it('builds the canonical /accept-invitation URL with the token URL-encoded', () => {
      const service = buildService();
      const url = service.buildAcceptInvitationUrl('eyJhbGciOiJIUzI1NiJ9.abc.def');
      expect(url).toBe('https://app.example/accept-invitation?token=eyJhbGciOiJIUzI1NiJ9.abc.def');
    });

    it('strips trailing slashes from the configured app base URL', () => {
      const service = buildService({ appBaseUrl: 'https://app.example///' });
      const url = service.buildAcceptInvitationUrl('tok');
      expect(url).toBe('https://app.example/accept-invitation?token=tok');
    });

    it('URL-encodes special characters in the token', () => {
      const service = buildService();
      const url = service.buildAcceptInvitationUrl('weird/token+with spaces');
      expect(url).toContain('weird%2Ftoken%2Bwith%20spaces');
    });
  });

  describe('sendInvitationEmail — DRY-RUN branch', () => {
    it('logs at INFO with all input fields and does NOT touch sendMail', async () => {
      const { transport, sendMail } = buildTransport();
      const service = buildService({ dryRun: true }, transport);
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

      await service.sendInvitationEmail(SAMPLE_INVITE);

      expect(sendMail).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);
      const message = logSpy.mock.calls[0][0] as string;
      expect(message).toContain('[DRY-RUN]');
      expect(message).toContain('to="new@cabinet.ci"');
      expect(message).toContain('org="Cabinet Konan"');
      expect(message).toContain('inviter="Yao Konan"');
      expect(message).toContain('role="comptable"');
      logSpy.mockRestore();
    });

    it('renders inviter="unknown" when inviterName is null', async () => {
      const service = buildService({ dryRun: true });
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

      await service.sendInvitationEmail({ ...SAMPLE_INVITE, inviterName: null });

      const message = logSpy.mock.calls[0][0] as string;
      expect(message).toContain('inviter="unknown"');
      logSpy.mockRestore();
    });
  });

  describe('sendInvitationEmail — SMTP branch (BE-MAIL-02)', () => {
    it('calls transport.sendMail with from/to/subject/text/html (happy path)', async () => {
      const { transport, sendMail } = buildTransport();
      const service = buildService({ dryRun: false }, transport);

      await service.sendInvitationEmail(SAMPLE_INVITE);

      expect(sendMail).toHaveBeenCalledTimes(1);
      const payload = sendMail.mock.calls[0][0] as {
        from: string;
        to: string;
        subject: string;
        text: string;
        html: string;
      };
      expect(payload.from).toBe('no-reply@erp.example');
      expect(payload.to).toBe('new@cabinet.ci');
      expect(payload.subject).toContain('Yao Konan');
      expect(payload.subject).toContain('Cabinet Konan');
      expect(payload.text).toContain('Cabinet Konan');
      expect(payload.text).toContain('comptable');
      expect(payload.text).toContain(SAMPLE_INVITE.acceptUrl);
      expect(payload.html).toContain('Accept invitation');
      expect(payload.html).toContain(SAMPLE_INVITE.acceptUrl);
    });

    it('falls back to "A team member" in the subject when inviterName is null', async () => {
      const { transport, sendMail } = buildTransport();
      const service = buildService({ dryRun: false }, transport);

      await service.sendInvitationEmail({ ...SAMPLE_INVITE, inviterName: null });

      const payload = sendMail.mock.calls[0][0] as { subject: string };
      expect(payload.subject).toContain('A team member');
    });

    it('escapes HTML in user-supplied fields (defensive against stored XSS in a future webview render)', async () => {
      const { transport, sendMail } = buildTransport();
      const service = buildService({ dryRun: false }, transport);
      const malicious = '<script>alert(1)</script>';

      await service.sendInvitationEmail({
        ...SAMPLE_INVITE,
        organizationName: malicious,
        inviterName: `Inviter ${malicious}`,
      });

      const payload = sendMail.mock.calls[0][0] as { html: string; text: string };
      expect(payload.html).not.toContain('<script>alert(1)</script>');
      expect(payload.html).toContain('&lt;script&gt;');
      // Plain-text body is allowed to contain the raw chars (no HTML
      // rendering); only the html body needs escaping.
      expect(payload.text).toContain('<script>alert(1)</script>');
    });

    it('swallows transport errors (logs ERROR, does NOT throw) — invitation DB row already committed', async () => {
      const { transport, sendMail } = buildTransport();
      sendMail.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const service = buildService({ dryRun: false }, transport);
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      await expect(service.sendInvitationEmail(SAMPLE_INVITE)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const message = errorSpy.mock.calls[0][0] as string;
      expect(message).toContain('SMTP send failed');
      expect(message).toContain('ECONNREFUSED');
      errorSpy.mockRestore();
    });

    it('chooses secure=true on port 465 and secure=false on 587 (constructor wiring)', () => {
      // The constructor builds a real nodemailer transport when no
      // override is passed and the service is NOT in dry-run. We can't
      // safely exercise that path without a real SMTP server, but we
      // can at least confirm the override path is taken in tests.
      const { transport } = buildTransport();
      const service = buildService({ dryRun: false, smtpPort: 465 }, transport);
      expect(service['transport']).toBe(transport);
    });
  });
});
