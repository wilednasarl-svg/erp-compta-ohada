import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * `GET /audit/logs` query parameters (BE-AUDIT-20).
 *
 * Filters are layered: `organizationId` is always inferred from the
 * authenticated tenant context — never from a query param — so we
 * intentionally do NOT expose it here. The supported filters cover the
 * five Module 7 read shapes documented in
 * `docs/produit/module-7-audit-trail.md`:
 *
 *   1. by module                       (`?module=chart_of_accounts`)
 *   2. by module + action              (`?module=auth&action=login_failed`)
 *   3. by entity                       (`?entityType=organization_account&entityId=…`)
 *   4. by user                         (`?userId=…`)
 *   5. by date range                   (`?from=…&to=…`)
 *
 * `module` and `action` are constrained to a conservative
 * `^[a-z][a-z0-9_]{0,63}$` shape — the same convention used by
 * `AuditModule` literals and writer-side action codes. Rejecting
 * anything else closes off a (low-value but non-zero) injection
 * surface around the indexed columns.
 *
 * `MAX_LIMIT` mirrors the legacy `ListAuthEventsQueryDto` so the two
 * audit views feel consistent to a frontend developer.
 *
 * Cursor pagination
 * -----------------
 * Pass `?cursor=<opaque>` instead of `?offset=N` for stable pagination
 * over a live journal. The cursor encodes `{createdAt, id}` of the last
 * row seen; the query becomes `(created_at, id) < (cursor.at, cursor.id)`
 * so inserts during navigation don't shift rows into/out of pages.
 * When `cursor` is present, `offset` is ignored.
 * The response includes `nextCursor` when more rows exist.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CODE_REGEX = /^[a-z][a-z0-9_]{0,63}$/;

export class ListAuditLogsQueryDto {
  @IsOptional()
  @IsString({ message: 'module must be a string' })
  @MaxLength(64)
  @Matches(CODE_REGEX, {
    message: 'module must be snake_case ASCII (e.g. chart_of_accounts)',
  })
  module?: string;

  @IsOptional()
  @IsString({ message: 'action must be a string' })
  @MaxLength(64)
  @Matches(CODE_REGEX, {
    message: 'action must be snake_case ASCII (e.g. account_updated)',
  })
  action?: string;

  @IsOptional()
  @IsString({ message: 'entityType must be a string' })
  @MaxLength(64)
  @Matches(CODE_REGEX, {
    message: 'entityType must be snake_case ASCII (e.g. organization_account)',
  })
  entityType?: string;

  @IsOptional()
  @IsUUID('4', { message: 'entityId must be a UUID v4' })
  entityId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'userId must be a UUID v4' })
  userId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO-8601 timestamp' })
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO-8601 timestamp' })
  to?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be >= 1' })
  @Max(MAX_LIMIT, { message: `limit must be <= ${MAX_LIMIT}` })
  limit: number = DEFAULT_LIMIT;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be >= 0' })
  offset: number = 0;

  /**
   * Opaque cursor returned by a previous `GET /audit/logs` response in
   * `pagination.nextCursor`. When present, `offset` is ignored and the
   * query uses `(created_at, id) < (cursor.at, cursor.id)` for stable
   * keyset pagination. The value is base64url(JSON) — treat as opaque.
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
