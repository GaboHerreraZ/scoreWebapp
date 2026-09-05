import { Module } from '@nestjs/common';
import { CreditStudiesController } from './credit-studies.controller.js';
import { CreditStudiesService } from './credit-studies.service.js';
import { CreditStudiesRepository } from './credit-studies.repository.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AnalysisPacksModule } from '../analysis-packs/analysis-packs.module.js';
import { CreditBureauModule } from '../credit-bureau/credit-bureau.module.js';
import { CustomerAuthorizationsModule } from '../customer-authorizations/customer-authorizations.module.js';
import { PromissoryNotesModule } from '../documents/promissory-notes/promissory-notes.module.js';
import { PaymentCapacityModule } from '../payment-capacity/payment-capacity.module.js';

@Module({
  imports: [
    ParametersModule,
    NotificationsModule,
    AnalysisPacksModule,
    CreditBureauModule,
    CustomerAuthorizationsModule,
    // Para adjuntar la URL del PDF firmado del pagaré en GET /:id/steps.
    PromissoryNotesModule,
    // Branch del estudio de capacidad de pago (perform + step2 de documentos).
    PaymentCapacityModule,
  ],
  controllers: [CreditStudiesController],
  providers: [CreditStudiesService, CreditStudiesRepository],
  exports: [CreditStudiesService],
})
export class CreditStudiesModule {}
