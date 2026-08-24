import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PaymentAlertsModule } from '../payment-alerts/payment-alerts.module.js';
import { PdfModule } from '../common/pdf/pdf.module.js';
import { MailModule } from '../mail/mail.module.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';
import { SalesCommissionsService } from './sales-commissions.service.js';
import { SalesRepository } from './sales.repository.js';

/**
 * Programa de referidos. Exporta:
 *  - SalesCommissionsService: la causación la dispara el webhook de pago.
 *  - SalesService: el onboarding resuelve el código que escribe el cliente.
 */
@Module({
  imports: [PrismaModule, PaymentAlertsModule, PdfModule, MailModule],
  controllers: [SalesController],
  providers: [SalesService, SalesCommissionsService, SalesRepository],
  exports: [SalesCommissionsService, SalesService],
})
export class SalesModule {}
