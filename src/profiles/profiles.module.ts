import { Module } from '@nestjs/common';
import { ProfilesController } from './profiles.controller.js';
import { ProfilesService } from './profiles.service.js';
import { ProfilesRepository } from './profiles.repository.js';
import { AnalysisPacksModule } from '../analysis-packs/analysis-packs.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';

@Module({
  imports: [AnalysisPacksModule, ParametersModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, ProfilesRepository],
  exports: [ProfilesService],
})
export class ProfilesModule {}
