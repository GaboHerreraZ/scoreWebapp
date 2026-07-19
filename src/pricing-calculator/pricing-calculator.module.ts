import { Module } from '@nestjs/common';
import { PricingCalculatorController } from './pricing-calculator.controller.js';
import { PricingCalculatorService } from './pricing-calculator.service.js';

@Module({
  controllers: [PricingCalculatorController],
  providers: [PricingCalculatorService],
  exports: [PricingCalculatorService],
})
export class PricingCalculatorModule {}
