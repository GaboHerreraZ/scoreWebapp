import { Module } from '@nestjs/common';
import { PackOfferingsController } from './pack-offerings.controller.js';
import { PackOfferingsService } from './pack-offerings.service.js';
import { PackOfferingsRepository } from './pack-offerings.repository.js';
import { ConsultationPricesModule } from '../consultation-prices/consultation-prices.module.js';

@Module({
  imports: [ConsultationPricesModule],
  controllers: [PackOfferingsController],
  providers: [PackOfferingsService, PackOfferingsRepository],
  exports: [PackOfferingsService, PackOfferingsRepository],
})
export class PackOfferingsModule {}
