import { Module } from '@nestjs/common';
import { StudyDocumentsController } from './study-documents.controller.js';
import { StudyDocumentsService } from './study-documents.service.js';
import { StudyDocumentsRepository } from './study-documents.repository.js';
import { PaymentCapacityService } from './payment-capacity.service.js';
import { PaymentCapacityRepository } from './payment-capacity.repository.js';
import { AiAnalysesModule } from '../ai-analyses/ai-analyses.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';

/**
 * Estudio de capacidad de pago (PN sin EEFF): documentos de ingreso (extractos,
 * desprendibles, facturas) con extracción IA + validaciones, y el análisis de
 * capacidad que alimenta el scoring. PrismaService y SupabaseService llegan por
 * los módulos globales. CreditStudiesModule importa este módulo para el branch
 * del perform/steps (nunca al revés: sin ciclos).
 */
@Module({
  imports: [AiAnalysesModule, ParametersModule],
  controllers: [StudyDocumentsController],
  providers: [
    StudyDocumentsService,
    StudyDocumentsRepository,
    PaymentCapacityService,
    PaymentCapacityRepository,
  ],
  exports: [
    StudyDocumentsService,
    StudyDocumentsRepository,
    PaymentCapacityService,
  ],
})
export class PaymentCapacityModule {}
