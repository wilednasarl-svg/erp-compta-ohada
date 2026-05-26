import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Path-param DTO for `GET /reports/import-diagnostic/:sessionId`.
 * Kept as a class to participate in the global ValidationPipe and to
 * keep Swagger's OpenAPI schema accurate.
 */
export class ImportDiagnosticParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sessionId!: string;
}
