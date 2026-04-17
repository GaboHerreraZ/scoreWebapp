import { Module, forwardRef } from '@nestjs/common';
import { CompanySubscriptionsController } from './company-subscriptions.controller.js';
import { CompanySubscriptionsService } from './company-subscriptions.service.js';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository.js';
import { EpaycoModule } from '../epayco/epayco.module.js';

@Module({
  imports: [forwardRef(() => EpaycoModule)],
  controllers: [CompanySubscriptionsController],
  providers: [CompanySubscriptionsService, CompanySubscriptionsRepository],
  exports: [CompanySubscriptionsService],
})
export class CompanySubscriptionsModule {}
