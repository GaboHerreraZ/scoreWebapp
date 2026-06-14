import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionPricingController } from './subscription-pricing.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { ConsultationPricesModule } from '../consultation-prices/consultation-prices.module.js';
import { EpaycoModule } from '../epayco/epayco.module.js';

@Module({
  imports: [ConsultationPricesModule, EpaycoModule],
  // SubscriptionPricingController expone POST /subscription-pricing aquí (no en
  // ConsultationPricesModule) para orquestar precio + resync sin ciclo de módulos.
  controllers: [SubscriptionsController, SubscriptionPricingController],
  providers: [SubscriptionsService, SubscriptionsRepository],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
