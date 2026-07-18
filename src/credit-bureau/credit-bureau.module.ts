import { Module } from '@nestjs/common';
import { CreditBureauService } from './credit-bureau.service.js';
import { CreditBureauRepository } from './credit-bureau.repository.js';
import { ExperianClient } from './experian/experian.client.js';
import { ExperianProvider } from './providers/experian.provider.js';
import { CREDIT_BUREAU_PROVIDER } from './providers/credit-bureau-provider.interface.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { CustomerAuthorizationsModule } from '../customer-authorizations/customer-authorizations.module.js';

@Module({
  imports: [ParametersModule, CustomerAuthorizationsModule],
  providers: [
    CreditBureauService,
    CreditBureauRepository,
    ExperianClient,
    ExperianProvider,
    { provide: CREDIT_BUREAU_PROVIDER, useClass: ExperianProvider },
  ],
  exports: [CreditBureauService],
})
export class CreditBureauModule {}
