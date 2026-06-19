import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PaymentAlertsService } from './payment-alerts.service.js';
import { PaymentAlertsRepository } from './payment-alerts.repository.js';
import { PaymentAlertsController } from './payment-alerts.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentAlertsController],
  providers: [PaymentAlertsService, PaymentAlertsRepository],
  exports: [PaymentAlertsService],
})
export class PaymentAlertsModule {}
