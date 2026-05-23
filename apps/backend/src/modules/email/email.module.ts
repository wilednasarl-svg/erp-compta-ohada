import { Module } from '@nestjs/common';

import { EmailService } from './services/email.service';

/**
 * `EmailModule` (BE-MAIL-01) — owns the `EmailService` outbound mail
 * surface. Currently a single concrete class honoring `EMAIL_DRY_RUN`;
 * a follow-up (BE-MAIL-02) will plug in nodemailer for the real send
 * path.
 *
 * No entities — email is a pure outbound side-effect.
 */
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
