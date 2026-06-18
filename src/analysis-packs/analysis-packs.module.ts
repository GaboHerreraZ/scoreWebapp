import { Module } from '@nestjs/common';
import { AnalysisPacksController } from './analysis-packs.controller.js';
import { AnalysisPacksWebhookController } from './analysis-packs-webhook.controller.js';
import { AnalysisPacksService } from './analysis-packs.service.js';
import { AnalysisPacksRepository } from './analysis-packs.repository.js';
import { PackOfferingsModule } from '../pack-offerings/pack-offerings.module.js';
import { ConsultationPricesModule } from '../consultation-prices/consultation-prices.module.js';
import { EpaycoModule } from '../epayco/epayco.module.js';

@Module({
  imports: [PackOfferingsModule, ConsultationPricesModule, EpaycoModule],
  controllers: [AnalysisPacksController, AnalysisPacksWebhookController],
  providers: [AnalysisPacksService, AnalysisPacksRepository],
  exports: [AnalysisPacksService, AnalysisPacksRepository],
})
export class AnalysisPacksModule {}
