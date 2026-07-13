import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller.js';
import { ScoringService } from './scoring.service.js';
import { ScoringRepository } from './scoring.repository.js';
import { ParametersModule } from '../parameters/parameters.module.js';

@Module({
  imports: [ParametersModule],
  controllers: [ScoringController],
  providers: [ScoringService, ScoringRepository],
  exports: [ScoringService, ScoringRepository],
})
export class ScoringModule {}
