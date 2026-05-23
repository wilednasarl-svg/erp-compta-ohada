import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { Public } from '../auth/decorators/public.decorator';

export interface HealthDbPayload {
  readonly ok: true;
}

@ApiTags('Health')
@Controller('health')
@Public()
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Liveness probe — the cheapest possible "process is up" check,
   * with no I/O. Consumed by Railway's healthcheck (`/health` per
   * `railway.toml`) and by any external uptime monitor.
   *
   * Kept separate from `/health/db` on purpose: a transient DB blip
   * (Supabase pooler restart, network hiccup) MUST NOT cycle the
   * container — k8s/Railway would mark the deploy failed and roll
   * back, when in fact the API process is perfectly healthy.
   * `/health/db` exists for the readiness/dependency side of that
   * coin and is what monitoring should page on.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  liveness(): { ok: true } {
    return { ok: true };
  }

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
