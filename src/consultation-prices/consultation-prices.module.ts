import { Module } from '@nestjs/common';
import { ConsultationPricesController } from './consultation-prices.controller.js';
import { ConsultationPricesService } from './consultation-prices.service.js';
import { ConsultationPricesRepository } from './consultation-prices.repository.js';

@Module({
  controllers: [ConsultationPricesController],
  providers: [ConsultationPricesService, ConsultationPricesRepository],
  exports: [ConsultationPricesService],
})
export class ConsultationPricesModule {}
