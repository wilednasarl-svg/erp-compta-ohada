import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthEventEntity } from './entities/auth-event.entity';
import { AuthEventRepository } from './repositories/auth-event.repository';
import { AuthEventsService } from './services/auth-events.service';

/**
 * `AuditModule` — owns the `auth_events` append-only journal.
 * `AuthEventsService` (BE-AUDIT-01) is the only sanctioned entry-point for
 * downstream modules; it wraps `AuthEventRepository.record()` with a typed
 * event union and a swallow-and-warn failure mode so a flaky audit table
 * cannot brick auth.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuthEventEntity])],
  providers: [AuthEventRepository, AuthEventsService],
  exports: [AuthEventRepository, AuthEventsService, TypeOrmModule],
})
export class AuditModule {}
