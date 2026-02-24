import { Module } from '@nestjs/common';
import { CompanySubscriptionsController } from './company-subscriptions.controller.js';
import { WompiWebhookController } from './wompi-webhook.controller.js';
import { CompanySubscriptionsService } from './company-subscriptions.service.js';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository.js';

@Module({
  controllers: [CompanySubscriptionsController, WompiWebhookController],
  providers: [CompanySubscriptionsService, CompanySubscriptionsRepository],
  exports: [CompanySubscriptionsService],
})
export class CompanySubscriptionsModule {}
