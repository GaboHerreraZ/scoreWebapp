import { Module } from '@nestjs/common';
import { BureauCheckController } from './bureau-check.controller.js';
import { BureauCheckService } from './bureau-check.service.js';
import { BureauCheckRepository } from './bureau-check.repository.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { AnalysisPacksModule } from '../analysis-packs/analysis-packs.module.js';
import { CreditBureauModule } from '../credit-bureau/credit-bureau.module.js';
import { CustomerAuthorizationsModule } from '../customer-authorizations/customer-authorizations.module.js';
import { AiAnalysesModule } from '../ai-analyses/ai-analyses.module.js';

/**
 * Consulta de riesgo crediticio (bureauCheck): flujo backend PROPIO — reusa por
 * inyección el gate de autorización, la consulta a la central (con caché) y el
 * consumo FIFO (bolsa bureauCheck), pero sin branches en credit-studies. El
 * entregable es el análisis IA (dato transformado), nunca el reporte crudo.
 * PrismaService, PdfService y FeatureFlags llegan por módulos globales.
 */
@Module({
  imports: [
    ParametersModule,
    AnalysisPacksModule,
    CreditBureauModule,
    CustomerAuthorizationsModule,
    AiAnalysesModule,
  ],
  controllers: [BureauCheckController],
  providers: [BureauCheckService, BureauCheckRepository],
  exports: [BureauCheckService],
})
export class BureauCheckModule {}
