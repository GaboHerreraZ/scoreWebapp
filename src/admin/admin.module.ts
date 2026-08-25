import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AuthMeController } from './auth-me.controller.js';
import { AdminService } from './admin.service.js';
import { PlatformUsersService } from './platform-users.service.js';
import { CompanyPurgeService } from './company-purge.service.js';
import { PdfExtractionTestService } from './pdf-extraction-test.service.js';
import { PdfExtractionTestRepository } from './pdf-extraction-test.repository.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { AnalysisPacksModule } from '../analysis-packs/analysis-packs.module.js';
import { ScoringModule } from '../scoring/scoring.module.js';
import { AiAnalysesModule } from '../ai-analyses/ai-analyses.module.js';
import { CreditBureauModule } from '../credit-bureau/credit-bureau.module.js';
import { EInvoicingModule } from '../e-invoicing/e-invoicing.module.js';

@Module({
  imports: [
    PrismaModule,
    ParametersModule,
    AnalysisPacksModule,
    ScoringModule,
    AiAnalysesModule,
    CreditBureauModule,
    EInvoicingModule,
  ],
  controllers: [AdminController, AuthMeController],
  providers: [
    AdminService,
    PlatformUsersService,
    CompanyPurgeService,
    PdfExtractionTestService,
    PdfExtractionTestRepository,
  ],
})
export class AdminModule {}
