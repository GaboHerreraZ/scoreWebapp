import { Module } from '@nestjs/common';
import { PricingCalculatorController } from './pricing-calculator.controller.js';
import { PricingCalculatorService } from './pricing-calculator.service.js';
import { ConsultationPricesModule } from '../consultation-prices/consultation-prices.module.js';

@Module({
  imports: [ConsultationPricesModule],
  controllers: [PricingCalculatorController],
  providers: [PricingCalculatorService],
  exports: [PricingCalculatorService],
})
export class PricingCalculatorModule {}
