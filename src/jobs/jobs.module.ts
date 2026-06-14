import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller.js';
import { SubscriptionExpiryService } from './subscription-expiry.service.js';
import { CompanySubscriptionsModule } from '../company-subscriptions/company-subscriptions.module.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [CompanySubscriptionsModule, MailModule],
  controllers: [JobsController],
  providers: [SubscriptionExpiryService],
})
export class JobsModule {}
