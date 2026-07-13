import { Module } from '@nestjs/common';
import { CreditStudiesController } from './credit-studies.controller.js';
import { CreditStudiesService } from './credit-studies.service.js';
import { CreditStudiesRepository } from './credit-studies.repository.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AnalysisPacksModule } from '../analysis-packs/analysis-packs.module.js';
import { CreditBureauModule } from '../credit-bureau/credit-bureau.module.js';

@Module({
  imports: [
    ParametersModule,
    NotificationsModule,
    AnalysisPacksModule,
    CreditBureauModule,
  ],
  controllers: [CreditStudiesController],
  providers: [CreditStudiesService, CreditStudiesRepository],
  exports: [CreditStudiesService],
})
export class CreditStudiesModule {}
