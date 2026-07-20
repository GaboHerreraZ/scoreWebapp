import { Module } from '@nestjs/common';
import { AiAnalysesController } from './ai-analyses.controller.js';
import { AiAnalysesService } from './ai-analyses.service.js';
import { AiAnalysesRepository } from './ai-analyses.repository.js';
import { AiModule } from '../ai/ai.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';

@Module({
  imports: [AiModule, ParametersModule],
  controllers: [AiAnalysesController],
  providers: [AiAnalysesService, AiAnalysesRepository],
  exports: [AiAnalysesService],
})
export class AiAnalysesModule {}
