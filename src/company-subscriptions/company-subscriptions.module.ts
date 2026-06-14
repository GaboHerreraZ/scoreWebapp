import { Module } from '@nestjs/common';
import { CompanySubscriptionsController } from './company-subscriptions.controller.js';
import { OnboardingPaymentController } from './onboarding-payment.controller.js';
import { EpaycoWebhookController } from '../epayco/epayco-webhook.controller.js';
import { CompanySubscriptionsService } from './company-subscriptions.service.js';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository.js';
import { EpaycoModule } from '../epayco/epayco.module.js';
import { ConsultationPricesModule } from '../consultation-prices/consultation-prices.module.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [EpaycoModule, ConsultationPricesModule, MailModule],
  controllers: [
    CompanySubscriptionsController,
    OnboardingPaymentController,
    EpaycoWebhookController,
  ],
  providers: [CompanySubscriptionsService, CompanySubscriptionsRepository],
  exports: [CompanySubscriptionsService, CompanySubscriptionsRepository],
})
export class CompanySubscriptionsModule {}
