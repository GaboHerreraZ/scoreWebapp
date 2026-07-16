import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller.js';
import { ScoringDimensionsController } from './scoring-dimensions.controller.js';
import { ScoringService } from './scoring.service.js';
import { ScoringRepository } from './scoring.repository.js';
import { ParametersModule } from '../parameters/parameters.module.js';

@Module({
  imports: [ParametersModule],
  controllers: [ScoringController, ScoringDimensionsController],
  providers: [ScoringService, ScoringRepository],
  exports: [ScoringService, ScoringRepository],
})
export class ScoringModule {}
