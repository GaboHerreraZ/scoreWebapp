import { Module } from '@nestjs/common';
import { FinancialStatementsController } from './financial-statements.controller.js';
import { FinancialStatementsService } from './financial-statements.service.js';
import { FinancialStatementsRepository } from './financial-statements.repository.js';
import { AiAnalysesModule } from '../ai-analyses/ai-analyses.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';

@Module({
  imports: [AiAnalysesModule, ParametersModule],
  controllers: [FinancialStatementsController],
  providers: [FinancialStatementsService, FinancialStatementsRepository],
  exports: [FinancialStatementsService],
})
export class FinancialStatementsModule {}
