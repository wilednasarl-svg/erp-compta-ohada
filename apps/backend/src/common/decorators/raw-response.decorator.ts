/**
 * `@RawResponse()` — opts a controller handler out of the global success
 * envelope applied by `ResponseEnvelopeInterceptor` (BE-BOOT-07).
 *
 * Use it on handlers that must return a body verbatim:
 *   - file/stream downloads,
 *   - third-party redirects or webhook acks,
 *   - any endpoint whose response shape is fixed by an external contract.
 *
 * Example:
 *   @Get('export.csv')
 *   @RawResponse()
 *   downloadCsv(): StreamableFile {
 *     return new StreamableFile(buffer);
 *   }
 *
 * The decorator simply attaches a reflector metadata flag; the interceptor
 * reads it via `Reflector.getAllAndOverride()` so the marker also works on
 * controller classes (applies to every handler).
 */

import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const RAW_RESPONSE_METADATA_KEY = 'app:raw-response';

export const RawResponse = (): CustomDecorator<string> =>
  SetMetadata(RAW_RESPONSE_METADATA_KEY, true);
