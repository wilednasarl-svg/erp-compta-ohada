import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * `GET /organizations/:id/auth-events?limit=&offset=` query parameters.
 *
 * Bounded to avoid an admin accidentally pulling the whole journal in one
 * shot (a large org can rack up tens of thousands of events). 200 is the
 * frontend page size cap; offset is open-ended (cursor pagination lands
 * with BE-AUDIT-03 if/when the journal grows past comfortable offset
 * scans).
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ListAuthEventsQueryDto {
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
}
