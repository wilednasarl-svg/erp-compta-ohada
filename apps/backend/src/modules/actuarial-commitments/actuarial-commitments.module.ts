import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActuarialCommitmentEntity } from './entities/actuarial-commitment.entity';
import { ActuarialCommitmentsRepository } from './repositories/actuarial-commitments.repository';
import { ActuarialCommitmentsService } from './services/actuarial-commitments.service';

/**
 * `ActuarialCommitmentsModule` — E2 (engagements actuariels retraite +
 * avantages au personnel, Tome 3 N16B + Tome 2 chap. 21).
 *
 * Wave 1 :
 *   - 1 entité TypeORM (mig 0109)
 *   - 1 repository tenant-scoped
 *   - 1 service applicatif (create / update / expire / lectures + sum)
 *
 * Pas de controller wave 1 — le module est consommé en lecture par le
 * handler N16B via injection directe du service (cf. follow-up :
 * wiring AppModule + REST E2-bis).
 */
@Module({
  imports: [TypeOrmModule.forFeature([ActuarialCommitmentEntity])],
  providers: [ActuarialCommitmentsRepository, ActuarialCommitmentsService],
  exports: [ActuarialCommitmentsService],
})
export class ActuarialCommitmentsModule {}
