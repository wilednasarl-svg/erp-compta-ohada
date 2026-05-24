import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import { ListReferenceChartQueryDto } from '../dto/list-reference-chart-query.dto';
import {
  ReferenceChartService,
  type ReferenceAccountView,
} from '../services/reference-chart.service';

/**
 * `ReferenceChartController` (BE-PC-07.1) — public read-only access to
 * the OHADA SYSCOHADA AUDCIF reference chart, segmented by accounting
 * system.
 *
 * `@Public()` opts the route out of the globally-registered
 * `JwtAuthGuard` (`APP_GUARD` in `app.module.ts`). The reference plan
 * is public knowledge — the entire AUDCIF is a free official document —
 * so gating it behind auth would offer no security benefit and would
 * complicate the wizard flow (`/organizations/new` lets the user
 * browse the three systems before signing up).
 */
@ApiTags('ReferenceChart')
@Controller('reference-chart-of-accounts')
export class ReferenceChartController {
  constructor(private readonly references: ReferenceChartService) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  async list(
    @Query() query: ListReferenceChartQueryDto,
  ): Promise<{ accounts: ReadonlyArray<ReferenceAccountView> }> {
    const accounts = await this.references.listBySystem(query.system);
    return { accounts };
  }
}
