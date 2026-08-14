import { Module } from '@nestjs/common';
import { AnalysisPacksController } from './analysis-packs.controller.js';
import { AnalysisPacksWebhookController } from './analysis-packs-webhook.controller.js';
import { AnalysisPacksReferenceController } from './analysis-packs-reference.controller.js';
import { AnalysisPacksService } from './analysis-packs.service.js';
import { AnalysisPacksRepository } from './analysis-packs.repository.js';
import { PackOfferingsModule } from '../pack-offerings/pack-offerings.module.js';
import { ConsultationPricesModule } from '../consultation-prices/consultation-prices.module.js';
import { EpaycoModule } from '../epayco/epayco.module.js';
import { PaymentAlertsModule } from '../payment-alerts/payment-alerts.module.js';
import { PromoCodesModule } from '../promo-codes/promo-codes.module.js';
import { MailModule } from '../mail/mail.module.js';
import { EInvoicingModule } from '../e-invoicing/e-invoicing.module.js';
import { MacroContractModule } from '../documents/macro-contract/macro-contract.module.js';

@Module({
  imports: [
    PackOfferingsModule,
    ConsultationPricesModule,
    EpaycoModule,
    PaymentAlertsModule,
    PromoCodesModule,
    MailModule,
    MacroContractModule,
    EInvoicingModule,
  ],
  controllers: [
    AnalysisPacksController,
    AnalysisPacksWebhookController,
    AnalysisPacksReferenceController,
  ],
  providers: [AnalysisPacksService, AnalysisPacksRepository],
  exports: [AnalysisPacksService, AnalysisPacksRepository],
})
export class AnalysisPacksModule {}
