import { Injectable, Logger } from '@nestjs/common';
// `pdfkit` ships only CommonJS exports — the default-import shape works
// once `esModuleInterop` is on (it is in this repo's tsconfig). Typed via
// `@types/pdfkit`.
import PDFDocument from 'pdfkit';

import type { OrganizationAccountEntity } from '../../accounting-plan/entities/organization-account.entity';
import type { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import type { EntrySignatureEntity, EntrySignerRole } from '../entities/entry-signature.entity';
import type { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import type { JournalEntity } from '../entities/journal.entity';

/**
 * Aggregate input for the PDF render. Caller assembles the slice from
 * its own repositories — keeps the generator a pure
 * data-in / Buffer-out function.
 */
export interface EntryPdfInput {
  readonly entry: JournalEntryEntity;
  readonly lines: ReadonlyArray<JournalEntryLineEntity>;
  readonly accountsById: ReadonlyMap<
    string,
    Pick<OrganizationAccountEntity, 'id' | 'code' | 'label'>
  >;
  readonly signatures: ReadonlyArray<EntrySignatureEntity>;
  readonly journal: Pick<JournalEntity, 'code' | 'label'>;
  readonly period: Pick<AccountingPeriodEntity, 'label' | 'startDate' | 'endDate'>;
  readonly organization: Pick<OrganizationEntity, 'id' | 'name'>;
  /** Final signature id used for verification URL; usually the
   *  `expert_comptable` signature on a locked entry. */
  readonly verificationSignatureId: string;
}

/**
 * `EntryPdfGenerator` — wave 2 Module 14.
 *
 * Renders a signed journal-entry PDF (header + lines + 2 signature
 * blocks + QR code linking back to the public verification endpoint).
 *
 * Designed as a pure side-effect-free service: takes pre-fetched data,
 * returns a `Buffer`. No DB access, no HTTP. Easy to unit-test.
 *
 * QR code support is optional at runtime: the `qrcode` package is
 * resolved lazily so jest/tsc do not fail when the dependency is not
 * yet installed locally (production wiring drops the dep into
 * `package.json`). When the module is unavailable the PDF still renders
 * — just without the QR square — and the verification URL is printed
 * as plain text so the document remains usable.
 */
@Injectable()
export class EntryPdfGenerator {
  private readonly logger = new Logger(EntryPdfGenerator.name);

  async generate(input: EntryPdfInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: this.docInfo(input) });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => {
      doc.on('end', () => resolve());
      doc.on('error', (err: Error) => reject(err));
    });

    this.renderHeader(doc, input);
    this.renderEntryBlock(doc, input);
    this.renderLinesTable(doc, input);
    this.renderSignatures(doc, input);
    await this.renderQrCode(doc, input);
    this.renderFooter(doc);

    doc.end();
    await done;
    return Buffer.concat(chunks);
  }

  // ─── Sections ───────────────────────────────────────────────────────

  private renderHeader(doc: PDFKit.PDFDocument, input: EntryPdfInput): void {
    doc.fontSize(10).fillColor('#555').text(input.organization.name, { align: 'right' });
    doc.moveDown(0.5);
    doc.fontSize(18).fillColor('#000').text('ECRITURE COMPTABLE VALIDEE', { align: 'center' });
    doc.fontSize(9).fillColor('#888').text('Document signe electroniquement', { align: 'center' });
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(1);
  }

  private renderEntryBlock(doc: PDFKit.PDFDocument, input: EntryPdfInput): void {
    const { entry, journal, period } = input;
    const label = (k: string, v: string): void => {
      doc.fontSize(10).fillColor('#555').text(k, { continued: true });
      doc.fillColor('#000').text(`  ${v}`);
    };

    label('Journal :', `${journal.code} - ${journal.label}`);
    label('N entry :', String(entry.entryNumber));
    label('Date :', entry.entryDate);
    label('Periode :', `${period.label} (${period.startDate} -> ${period.endDate})`);
    if (entry.reference) {
      label('Reference :', entry.reference);
    }
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#000').text('Description', { underline: true });
    doc.fontSize(10).text(entry.description, { width: 495 });
    doc.moveDown(1);
  }

  private renderLinesTable(doc: PDFKit.PDFDocument, input: EntryPdfInput): void {
    const xCode = 50;
    const xLabel = 110;
    const xDebit = 380;
    const xCredit = 470;

    doc.fontSize(10).fillColor('#000');
    doc.font('Helvetica-Bold');
    const headerY = doc.y;
    doc.text('Compte', xCode, headerY, { width: 55 });
    doc.text('Libelle', xLabel, headerY, { width: 260 });
    doc.text('Debit', xDebit, headerY, { width: 80, align: 'right' });
    doc.text('Credit', xCredit, headerY, { width: 75, align: 'right' });
    doc.font('Helvetica');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.25);

    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of input.lines) {
      const acc = input.accountsById.get(line.accountId);
      const code = acc?.code ?? '??';
      const accLabel = acc?.label ?? '';
      const lineLabel = line.description ?? accLabel;
      const debit = Number(line.debit ?? '0');
      const credit = Number(line.credit ?? '0');
      totalDebit += debit;
      totalCredit += credit;

      const y = doc.y;
      doc.text(code, xCode, y, { width: 55 });
      doc.text(lineLabel, xLabel, y, { width: 260 });
      doc.text(this.fmtAmount(debit), xDebit, y, { width: 80, align: 'right' });
      doc.text(this.fmtAmount(credit), xCredit, y, { width: 75, align: 'right' });
      doc.moveDown(0.2);
    }

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#888').stroke();
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold');
    const totalsY = doc.y;
    doc.text('TOTAL', xLabel, totalsY, { width: 260 });
    doc.text(this.fmtAmount(totalDebit), xDebit, totalsY, { width: 80, align: 'right' });
    doc.text(this.fmtAmount(totalCredit), xCredit, totalsY, { width: 75, align: 'right' });
    doc.font('Helvetica');
    doc.moveDown(1.5);
  }

  private renderSignatures(doc: PDFKit.PDFDocument, input: EntryPdfInput): void {
    doc.fontSize(11).fillColor('#000').text('Signatures electroniques', { underline: true });
    doc.moveDown(0.5);

    const roleOrder: ReadonlyArray<EntrySignerRole> = ['chef_mission', 'expert_comptable'];
    const byRole = new Map<EntrySignerRole, EntrySignatureEntity>();
    for (const s of input.signatures) byRole.set(s.signerRole, s);

    const blockY = doc.y;
    let col = 0;
    for (const role of roleOrder) {
      const sig = byRole.get(role);
      const x = 50 + col * 250;
      doc.fontSize(10).fillColor('#555').text(this.roleLabel(role), x, blockY, { width: 230 });
      doc
        .fontSize(9)
        .fillColor('#000')
        .text(sig ? `Signe le ${sig.signedAt.toISOString()}` : '- non signe -', x, blockY + 14, {
          width: 230,
        });
      doc
        .fontSize(8)
        .fillColor('#888')
        .text(
          sig
            ? `Empreinte: ${sig.signatureHash.slice(0, 16)}...${sig.signatureHash.slice(-8)}`
            : '',
          x,
          blockY + 28,
          { width: 230 },
        );
      col += 1;
    }

    doc.moveDown(4);
    doc.fillColor('#000');
  }

  private async renderQrCode(doc: PDFKit.PDFDocument, input: EntryPdfInput): Promise<void> {
    const url = buildVerifyUrl(input.verificationSignatureId);
    const png = await tryRenderQrPng(url);

    const x = 430;
    const y = doc.page.height - 200;
    if (png) {
      try {
        doc.image(png, x, y, { width: 110, height: 110 });
      } catch (e: unknown) {
        this.logger.warn(`QR image render failed: ${String(e)}`);
        doc.rect(x, y, 110, 110).strokeColor('#ccc').stroke();
      }
    } else {
      doc.rect(x, y, 110, 110).strokeColor('#ccc').stroke();
      doc
        .fontSize(7)
        .fillColor('#888')
        .text('QR indisponible', x, y + 52, {
          width: 110,
          align: 'center',
        });
    }
    doc
      .fontSize(7)
      .fillColor('#555')
      .text('Verifier la signature :', x, y + 115, { width: 110, align: 'center' });
    doc
      .fontSize(6)
      .fillColor('#1a73e8')
      .text(url, x, y + 125, { width: 110, align: 'center' });
  }

  private renderFooter(doc: PDFKit.PDFDocument): void {
    const y = doc.page.height - 60;
    doc
      .fontSize(8)
      .fillColor('#888')
      .text('Conforme SYSCOHADA AUDCIF - Document genere automatiquement.', 50, y, {
        align: 'center',
        width: 495,
      });
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private docInfo(input: EntryPdfInput): PDFKit.PDFDocumentOptions['info'] {
    return {
      Title: `Ecriture ${input.journal.code}-${input.entry.entryNumber}`,
      Author: input.organization.name,
      Subject: 'Ecriture comptable signee',
      Keywords: 'SYSCOHADA, signature electronique, journal',
    };
  }

  private fmtAmount(n: number): string {
    if (!Number.isFinite(n) || n === 0) return '-';
    return n.toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private roleLabel(role: EntrySignerRole): string {
    return role === 'chef_mission' ? 'Chef de mission' : 'Expert-comptable';
  }
}

/**
 * Public helper — exported so the verification controller / notification
 * service can compute the same URL the PDF embeds (single source of
 * truth). Honours `PUBLIC_VERIFY_URL` env override; falls back to the
 * spec's documented default. Trailing slashes are tolerated.
 */
export function buildVerifyUrl(signatureId: string): string {
  const raw = process.env.PUBLIC_VERIFY_URL ?? 'https://erp.example.com';
  const base = raw.replace(/\/+$/u, '');
  return `${base}/verify-signature/${encodeURIComponent(signatureId)}`;
}

/**
 * Lazy + defensive `qrcode` loader. Returns a PNG Buffer on success,
 * `null` if the package is not installed or fails to render. Logging is
 * intentionally silent here (the generator surfaces a placeholder box
 * so the document is still valid).
 */
async function tryRenderQrPng(text: string): Promise<Buffer | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod: unknown = require('qrcode');
    const toBuffer = (mod as { toBuffer?: (t: string) => Promise<Buffer> } | null)?.toBuffer;
    if (typeof toBuffer !== 'function') return null;
    return await toBuffer(text);
  } catch {
    return null;
  }
}
