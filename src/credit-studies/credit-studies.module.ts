import { Module } from '@nestjs/common';
import { CreditStudiesController } from './credit-studies.controller.js';
import { CreditStudiesService } from './credit-studies.service.js';
import { CreditStudiesRepository } from './credit-studies.repository.js';
import { ParametersModule } from '../parameters/parameters.module.js';

@Module({
  imports: [ParametersModule],
  controllers: [CreditStudiesController],
  providers: [CreditStudiesService, CreditStudiesRepository],
  exports: [CreditStudiesService],
})
export class CreditStudiesModule {}
