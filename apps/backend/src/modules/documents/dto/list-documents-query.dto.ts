import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  DOCUMENT_CATEGORY_VALUES,
  type DocumentCategory,
} from '../types/document-category';
import { OCR_STATUS_VALUES, type OcrStatus } from '../types/ocr-status';

/**
 * `GET /documents` query parameters. All filters are optional and
 * combine with AND semantics. Pagination defaults to `page=1`,
 * `pageSize=20`; `pageSize` is capped at 100 to keep the response
 * bounded.
 */
export class ListDocumentsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tag?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  /**
   * Coarse "type of file" facet. Independent from `mimeType` (an exact
   * match) — both may be supplied and combine with AND semantics. The
   * MIME -> category mapping lives in the repository.
   */
  @IsOptional()
  @IsIn(DOCUMENT_CATEGORY_VALUES as ReadonlyArray<string>)
  category?: DocumentCategory;

  @IsOptional()
  @IsUUID('4')
  uploadedBy?: string;

  @IsOptional()
  @IsIn(OCR_STATUS_VALUES as ReadonlyArray<string>)
  ocrStatus?: OcrStatus;

  @IsOptional()
  @IsDateString()
  uploadedFrom?: string;

  @IsOptional()
  @IsDateString()
  uploadedTo?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }: { value: unknown }): string[] | undefined => {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    if (typeof value === 'string' && value.length > 0) {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return undefined;
  })
  linkedEntryIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
