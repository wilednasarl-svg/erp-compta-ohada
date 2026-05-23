import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface HealthDbPayload {
  readonly ok: true;
}

@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Database connectivity probe.
   *
   * Returns the raw payload `{ ok: true }`; the global
   * `ResponseEnvelopeInterceptor` (BE-BOOT-07) wraps it into
   * `{ data: { ok: true }, error: null }`. Wrapping it here would
   * double-envelope the response (see beads projet-ferme-2gd).
   *
   * On failure, throws `ServiceUnavailableException` so that orchestrators
   * (k8s probe, uptime monitor) get a 503 instead of a 200-with-error
   * payload. The error body is shaped by the future global exception
   * filter (BE-BOOT-06).
   */
  @Get('db')
  @HttpCode(HttpStatus.OK)
  async checkDb(): Promise<HealthDbPayload> {
    try {
      await this.dataSource.query('SELECT 1');
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown database error';
      throw new ServiceUnavailableException(message);
    }
  }
}
