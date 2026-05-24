import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import { asTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { ListDocumentsQueryDto } from '../dto/list-documents-query.dto';
import { UploadDocumentDto } from '../dto/upload-document.dto';
import {
  DocumentsService,
  type DocumentView,
  type ListDocumentsResult,
} from '../services/documents.service';

/**
 * Multer file shape. We avoid pulling `@types/multer` into the
 * dependency graph by re-declaring just the fields we touch — multer
 * ships the values as-is whether or not the typings are installed.
 */
interface UploadedMulterFile {
  readonly fieldname: string;
  readonly originalname: string;
  readonly encoding: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/**
 * `DocumentsController` (BE-DOC-05) — RBAC-gated, tenant-scoped HTTP
 * surface for the Document Engine.
 *
 *   POST   /documents               — upload (documents.write)
 *   GET    /documents               — list / filter (documents.read)
 *   GET    /documents/:id           — metadata (documents.read)
 *   GET    /documents/:id/content   — download bytes (documents.read)
 *   DELETE /documents/:id           — soft-delete (documents.write)
 *
 * `TenantGuard` resolves the tenant from the JWT — there is no `/:orgId`
 * path segment on this surface (the documents store is org-singular
 * by JWT scope). Defence-in-depth: every handler routes through
 * `assertActorScope` so a route accidentally exposed without
 * `TenantGuard` would still fail-closed with 404 instead of leaking
 * cross-tenant rows.
 */
@ApiTags('Documents')
@ApiBearerAuth('bearer')
@Controller('documents')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @RequirePermission('documents.write')
  @HttpCode(HttpStatus.CREATED)
  // Transport-layer file-size cap so multer aborts the request stream
  // before buffering an oversized body in memory. The +1 MB headroom
  // keeps the precise size check in the service (which surfaces the
  // structured `DOC_FILE_TOO_LARGE` error code).
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: (Number.parseInt(process.env.DOC_MAX_FILE_SIZE_MB ?? '25', 10) + 1) * 1024 * 1024,
      },
    }),
  )
  async upload(
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body() body: UploadDocumentDto,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<{ document: DocumentView }> {
    const scope = this.assertActorScope(org, actorUserId);
    const document = await this.documents.createFromUpload(
      scope.organizationId,
      scope.actorUserId,
      file === undefined
        ? undefined
        : {
            originalName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            body: file.buffer,
          },
      {
        tags: body.tags,
        linkedEntryIds: body.linkedEntryIds,
        description: body.description ?? null,
      },
      buildAuditRequestContext(req),
    );
    return { document };
  }

  @Get()
  @RequirePermission('documents.read')
  @HttpCode(HttpStatus.OK)
  async list(
    @Query() query: ListDocumentsQueryDto,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
  ): Promise<ListDocumentsResult> {
    const scope = this.assertActorScope(org, actorUserId);
    return this.documents.listForOrg(
      scope.organizationId,
      {
        tag: query.tag,
        mimeType: query.mimeType,
        uploadedBy: query.uploadedBy,
        ocrStatus: query.ocrStatus,
        uploadedFrom: query.uploadedFrom !== undefined ? new Date(query.uploadedFrom) : undefined,
        uploadedTo: query.uploadedTo !== undefined ? new Date(query.uploadedTo) : undefined,
        linkedEntryIds: query.linkedEntryIds,
      },
      {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      },
    );
  }

  @Get(':id')
  @RequirePermission('documents.read')
  @HttpCode(HttpStatus.OK)
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
  ): Promise<{ document: DocumentView }> {
    const scope = this.assertActorScope(org, actorUserId);
    const document = await this.documents.getForOrg(scope.organizationId, id);
    return { document };
  }

  /**
   * Proxy endpoint that streams the bytes back to the client. Wave 1
   * ships the local-FS driver so we can't hand out a signed URL —
   * everything routes through this Express response. Wave 2 will swap
   * in an S3 / Supabase driver and may add a signed-URL fast path,
   * but the URL contract advertised to clients (`/documents/:id/content`)
   * stays stable so the frontend doesn't have to change.
   */
  @Get(':id/content')
  @RequirePermission('documents.read')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  async download(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const scope = this.assertActorScope(org, actorUserId);
    const { stream, filename, mimeType, sizeBytes } = await this.documents.openStreamForOrg(
      scope.organizationId,
      id,
    );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(sizeBytes));
    // RFC 5987 + CRLF strip: a stored `filename` containing CR/LF or
    // `"` could otherwise inject extra response headers. We strip
    // CR/LF defensively and use the `filename*` form so non-ASCII
    // characters survive the percent-encoding round-trip in modern
    // browsers (audit Module 3 Sec-M4).
    const safeName = filename.replace(/[\r\n"]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    );
    // `X-Content-Type-Options: nosniff` prevents browsers from
    // overriding the declared `Content-Type` with their own sniff,
    // closing the back-door where a `text/csv` (legitimately allowed)
    // could be re-interpreted as `text/html` by IE/Edge legacy
    // (audit Module 3 Sec-M3 hardening).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.on('error', (error) => {
      // The headers may have been flushed already; falling back to
      // `res.destroy(error)` lets Express signal the client an
      // abrupt close without leaking a stack trace.
      res.destroy(error);
    });
    stream.pipe(res);
  }

  @Delete(':id')
  @RequirePermission('documents.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<void> {
    const scope = this.assertActorScope(org, actorUserId);
    await this.documents.softDelete(
      scope.organizationId,
      id,
      scope.actorUserId,
      buildAuditRequestContext(req),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private assertActorScope(
    org: CurrentOrgContext | undefined,
    actorUserId: string | undefined,
  ): { organizationId: TenantId; actorUserId: string } {
    if (org === undefined || org.id.length === 0) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }
    if (actorUserId === undefined || actorUserId.length === 0) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    return { organizationId: asTenantId(org.id), actorUserId };
  }
}
