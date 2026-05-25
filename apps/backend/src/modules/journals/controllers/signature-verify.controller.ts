import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import { computeEntrySignatureHash } from '../lib/signature-hash';
import { EntrySignatureRepository } from '../repositories/entry-signature.repository';
import { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';
import { JournalEntryRepository } from '../repositories/journal-entry.repository';
import type { EntrySignerRole } from '../entities/entry-signature.entity';

/**
 * Public verification view. Designed so a third party (auditor, tax
 * inspector) can scan the QR code on a signed PDF, hit this endpoint
 * and immediately see whether the signature still matches the
 * underlying entry. No PII is exposed — only the role, timestamp, and
 * an opaque entry reference (`<journal-code>-<entry-number>` is
 * exposed by the workflow elsewhere; here we surface just the entry id
 * to keep this endpoint independent of journal lookups).
 */
export interface VerifySignatureView {
  readonly valid: boolean;
  readonly signerRole: EntrySignerRole | null;
  readonly signedAt: Date | null;
  readonly entryRef: string | null;
  readonly reason?: 'not_found' | 'tampered';
}

/**
 * Module 14 wave 2 — public signature verification endpoint.
 *
 * Mounted unauthenticated under `GET /verify-signature/:id`. Returns
 * `valid: true` iff the signature row exists AND the recomputed hash
 * over the current entry state still matches the hash captured at
 * signing time. Any post-signature mutation of the entry header / lines
 * surfaces as `valid: false, reason: 'tampered'`.
 *
 * Tenant scope: this controller intentionally bypasses
 * `TenantGuard` — the verifier has no JWT and no `organization_id`
 * claim. The signature row carries its own `organization_id`, which we
 * use to look up the entry from the same tenant. Cross-tenant exposure
 * is impossible because the only data leaving the endpoint is the
 * boolean result + role + timestamp, no organization name, no entry
 * description.
 */
@ApiTags('Signature Verification')
@Controller('verify-signature')
export class SignatureVerifyController {
  constructor(
    private readonly signatures: EntrySignatureRepository,
    private readonly entries: JournalEntryRepository,
    private readonly lines: JournalEntryLineRepository,
  ) {}

  @Get(':id')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifier publiquement une signature électronique (no auth)' })
  async verify(
    @Param('id', new ParseUUIDPipe({ version: '4' })) signatureId: string,
  ): Promise<VerifySignatureView> {
    const sig = await this.signatures.findById(signatureId);
    if (sig === null) {
      throw new NotFoundException({
        valid: false,
        signerRole: null,
        signedAt: null,
        entryRef: null,
        reason: 'not_found',
      } satisfies VerifySignatureView);
    }

    const entry = await this.entries.findById(sig.journalEntryId, sig.organizationId);
    if (entry === null) {
      return {
        valid: false,
        signerRole: sig.signerRole,
        signedAt: sig.signedAt,
        entryRef: null,
        reason: 'tampered',
      };
    }

    const lines = await this.lines.listByEntry(entry.id);
    const recomputed = computeEntrySignatureHash(entry, lines);
    const valid = recomputed === sig.signatureHash;

    return {
      valid,
      signerRole: sig.signerRole,
      signedAt: sig.signedAt,
      entryRef: entry.id,
      ...(valid ? {} : { reason: 'tampered' as const }),
    };
  }
}
