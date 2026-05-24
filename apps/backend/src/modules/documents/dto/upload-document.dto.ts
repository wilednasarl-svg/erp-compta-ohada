import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Multipart upload body. The actual file bytes are carried by the
 * `file` form-field (intercepted by `FileInterceptor` in the controller)
 * and are NOT validated here — the service is responsible for size /
 * MIME / checksum.
 *
 * `tags` and `linkedEntryIds` can be sent in two shapes — multer flattens
 * repeated fields into either a `string[]` or a JSON-encoded scalar
 * depending on the client. The `@Transform` decorators below collapse
 * both into a `string[]` so the service sees a single shape.
 */
export class UploadDocumentDto {
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @Transform(({ value }) => coerceStringArray(value))
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  @Transform(({ value }) => coerceStringArray(value))
  linkedEntryIds?: string[];
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        // fall through to single-string handling
      }
    }
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return undefined;
}
