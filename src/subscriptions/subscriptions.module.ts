import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { CompanySubscriptionsModule } from '../company-subscriptions/company-subscriptions.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';

@Module({
  imports: [CompanySubscriptionsModule, CampaignsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionsRepository],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
