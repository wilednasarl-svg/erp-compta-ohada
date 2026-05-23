import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthEventEntity } from './entities/auth-event.entity';
import { AuthEventRepository } from './repositories/auth-event.repository';

/**
 * `AuditModule` — owns the `auth_events` append-only journal. The
 * `AuthEventsService` wrapper (BE-AUDIT-*) wraps the repository to keep
 * call sites short (`audit.record('auth.signup', {...})`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuthEventEntity])],
  providers: [AuthEventRepository],
  exports: [AuthEventRepository, TypeOrmModule],
})
export class AuditModule {}
