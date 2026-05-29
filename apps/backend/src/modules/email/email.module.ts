import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TvaDeclarationEntity } from '../tva/entities/tva-declaration.entity';
import { MembershipEntity } from '../rbac/entities/membership.entity';
import { EmailService } from './services/email.service';
import { TvaNotificationService } from './services/tva-notification.service';

@Module({
  imports: [TypeOrmModule.forFeature([TvaDeclarationEntity, MembershipEntity])],
  providers: [EmailService, TvaNotificationService],
  exports: [EmailService],
})
export class EmailModule {}
