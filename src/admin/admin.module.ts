import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AuthMeController } from './auth-me.controller.js';
import { AdminService } from './admin.service.js';
import { PdfExtractionTestService } from './pdf-extraction-test.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { AnalysisPacksModule } from '../analysis-packs/analysis-packs.module.js';
import { ScoringModule } from '../scoring/scoring.module.js';
import { AiAnalysesModule } from '../ai-analyses/ai-analyses.module.js';

@Module({
  imports: [
    PrismaModule,
    ParametersModule,
    AnalysisPacksModule,
    ScoringModule,
    AiAnalysesModule,
  ],
  controllers: [AdminController, AuthMeController],
  providers: [AdminService, PdfExtractionTestService],
})
export class AdminModule {}
