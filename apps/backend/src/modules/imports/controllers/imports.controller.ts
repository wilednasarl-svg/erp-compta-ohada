import { Readable } from 'node:stream';

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { CreateImportSessionDto } from '../dto/create-import-session.dto';
import { PreviewImportDto } from '../dto/preview-import.dto';
import { UpdateMappingOverrideDto } from '../dto/update-mapping-override.dto';
import { ImportAnalyticsService } from '../services/import-analytics.service';
import {
  ImportSessionService,
  type CommitResult,
  type PreviewResult,
  type SessionSummary,
} from '../services/import-session.service';
import type { ImportAnalytics } from '../types/import-analytics';

/**
 * Local Multer file shape (subset of Express.Multer.File). Avoids a
 * direct `Express.Multer.File` type reference so the controller stays
 * unit-testable without the multer ambient namespace.
 */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * `ImportsController` (BE-IMP-controller) — endpoints du module
 * d'import comptable.
 *
 *   POST   /sessions               — crée une session draft
 *   GET    /sessions               — liste les sessions de l'org
 *   GET    /sessions/:sessionId    — détail d'une session
 *   POST   /sessions/:sessionId/files     — upload + parse + persist staging
 *   POST   /sessions/:sessionId/preview   — mapping auto + validation + preview
 *
 * Mount path `organizations/:id/imports` ⇒ tout passe par `TenantGuard`
 * + `assertOrgMatch` pour interdire l'accès cross-tenant même si un
 * sessionId fuyait.
 *
 * Le upload est mémoire (Multer `memoryStorage` par défaut sans
 * configuration globale ; on borde la taille via la limite
 * configurable de l'intercepteur). Pour 25 Mo / fichier, c'est sans
 * risque ; un futur switch vers `diskStorage` ou direct-to-S3
 * pourra évacuer la mémoire si la limite haute monte.
 */
@ApiTags('Imports')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/imports')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ImportsController {
  constructor(
    private readonly importSessions: ImportSessionService,
    private readonly importAnalytics: ImportAnalyticsService,
  ) {}

  // ─── Sessions ───────────────────────────────────────────────────────

  @Post('sessions')
  @RequirePermission('imports.write')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateImportSessionDto,
    @Req() req: Request,
  ): Promise<{ session: SessionSummary }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const session = await this.importSessions.createSession(
      asTenantId(tokenOrgId),
      {
        sourceType: body.sourceType,
        label: body.label ?? null,
        companyId: body.companyId ?? null,
        fiscalYear: body.fiscalYear ?? null,
      },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { session };
  }

  @Get('sessions')
  @RequirePermission('imports.read')
  @HttpCode(HttpStatus.OK)
  async listSessions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ sessions: SessionSummary[] }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const sessions = await this.importSessions.listSessions(asTenantId(tokenOrgId));
    return { sessions };
  }

  @Get('sessions/:sessionId')
  @RequirePermission('imports.read')
  @HttpCode(HttpStatus.OK)
  async getSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ session: SessionSummary }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const session = await this.importSessions.getSession(asTenantId(tokenOrgId), sessionId);
    return { session };
  }

  // ─── File upload + parse ────────────────────────────────────────────

  @Post('sessions/:sessionId/files')
  @RequirePermission('imports.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  // Multer hard cap on upload bytes — read once at module load from env
  // so the transport layer aborts the request stream BEFORE the whole
  // body is buffered in memory. Without this, `multer` happily reads
  // gigabytes into a Buffer just for our service layer to reject it.
  // The cap here intentionally tracks `IMPORT_MAX_FILE_SIZE_MB` env
  // (with a +1 MB headroom so the precise limit check stays in the
  // service layer where the error code is structured).
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize:
          (Number.parseInt(process.env.IMPORT_MAX_FILE_SIZE_MB ?? '50', 10) + 1) * 1024 * 1024,
      },
    }),
  )
  async uploadFile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Req() req: Request,
  ): Promise<{ fileId: string; parsed: { rowsParsed: number; headers: readonly string[] } }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    if (!file) {
      throw new AppException(ERROR_CODES.IMPORT_UNSUPPORTED_FORMAT, {
        message: 'A file is required in the "file" multipart field',
      });
    }

    const orgScoped = asTenantId(tokenOrgId);
    const upload = await this.importSessions.uploadFile(
      orgScoped,
      sessionId,
      {
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        content: Readable.from(file.buffer),
      },
      actorUserId,
      buildAuditRequestContext(req),
    );

    // Parse immediately so the caller gets staging rows in one HTTP
    // round-trip. Vague 2 may move this to a background queue if file
    // sizes / parse times grow.
    const parsed = await this.importSessions.parseFile(
      orgScoped,
      sessionId,
      upload.fileId,
      actorUserId,
      buildAuditRequestContext(req),
    );

    return { fileId: upload.fileId, parsed };
  }

  // ─── Preview ────────────────────────────────────────────────────────

  @Post('sessions/:sessionId/preview')
  @RequirePermission('imports.read')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Query() query: PreviewImportDto,
    @Req() req: Request,
  ): Promise<PreviewResult> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    return this.importSessions.preview(
      asTenantId(tokenOrgId),
      sessionId,
      actorUserId,
      buildAuditRequestContext(req),
      { limit: query.limit, offset: query.offset },
    );
  }

  // ─── Override Mapping ────────────────────────────────────────────────

  @Patch('sessions/:sessionId/mapping')
  @RequirePermission('imports.write')
  @HttpCode(HttpStatus.OK)
  async updateMappingOverride(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: UpdateMappingOverrideDto,
    @Req() req: Request,
  ): Promise<{ success: boolean }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    await this.importSessions.updateMappingOverride(
      asTenantId(tokenOrgId),
      sessionId,
      body.mappingOverride ?? {},
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { success: true };
  }

  // ─── Analytics ──────────────────────────────────────────────────────

  @Get('sessions/:sessionId/analytics')
  @RequirePermission('imports.read')
  @HttpCode(HttpStatus.OK)
  async getAnalytics(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ analytics: ImportAnalytics }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const analytics = await this.importAnalytics.compute(asTenantId(tokenOrgId), sessionId);
    return { analytics };
  }

  // ─── Commit (wave 2) ────────────────────────────────────────────────

  @Post('sessions/:sessionId/commit')
  @RequirePermission('imports.commit')
  @HttpCode(HttpStatus.OK)
  async commitSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<{ result: CommitResult }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.importSessions.commitSession(
      asTenantId(tokenOrgId),
      sessionId,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { result };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: string | undefined,
  ): asserts tokenOrgId is string {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }
  }

  private assertActor(actorUserId: string | undefined): asserts actorUserId is string {
    if (actorUserId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
  }
}
