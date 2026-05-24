import { IsIn } from 'class-validator';

import { ACCOUNTING_SYSTEMS, type AccountingSystem } from '../types/accounting-system';

/**
 * `GET /reference-chart-of-accounts?system=NORMAL|MINIMAL|ALLEGE` query.
 *
 * `system` is required — there is no sensible default since the three
 * AUDCIF systems are mutually exclusive entry points (an org bound to
 * `MINIMAL` should never see Normal-only accounts in its reference
 * picker). Missing or invalid value surfaces as `422 VALIDATION_ERROR`.
 */
export class ListReferenceChartQueryDto {
  @IsIn([...ACCOUNTING_SYSTEMS], {
    message: `system must be one of: ${ACCOUNTING_SYSTEMS.join(', ')}`,
  })
  system!: AccountingSystem;
}
