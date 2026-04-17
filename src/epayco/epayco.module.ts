import { Module, forwardRef } from '@nestjs/common';
import { EpaycoService } from './epayco.service.js';
import { EpaycoDebugController } from './epayco-debug.controller.js';
import { EpaycoWebhookController } from './epayco-webhook.controller.js';
import { CompanySubscriptionsModule } from '../company-subscriptions/company-subscriptions.module.js';

@Module({
  imports: [forwardRef(() => CompanySubscriptionsModule)],
  controllers: [EpaycoDebugController, EpaycoWebhookController],
  providers: [EpaycoService],
  exports: [EpaycoService],
})
export class EpaycoModule {}
