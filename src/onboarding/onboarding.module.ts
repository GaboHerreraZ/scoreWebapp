import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { EInvoicingModule } from '../e-invoicing/e-invoicing.module.js';
import { SalesModule } from '../sales/sales.module.js';

@Module({
  imports: [PrismaModule, ParametersModule, EInvoicingModule, SalesModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
