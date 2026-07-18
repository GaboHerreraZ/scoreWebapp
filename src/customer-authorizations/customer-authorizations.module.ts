import { Module } from '@nestjs/common';
import { CustomerAuthorizationsService } from './customer-authorizations.service.js';
import { CustomerAuthorizationsRepository } from './customer-authorizations.repository.js';
import { CustomerAuthorizationsController } from './customer-authorizations.controller.js';
import { SigningModule } from '../documents/signing/signing.module.js';
import { ParametersModule } from '../parameters/parameters.module.js';

/**
 * Autorización del titular consultado (documento único: tratamiento + habeas
 * data + custodia) firmada vía Zapsign. Expone el endpoint de consulta de estado
 * y el service como GATE del bureau (resolveForConsult / ensureCanConsult /
 * linkConsultedCustomer), por eso se exporta. Los webhooks de Zapsign los recibe
 * el despachador único (ZapsignWebhooksModule), que enruta por token.
 */
@Module({
  imports: [SigningModule, ParametersModule],
  controllers: [CustomerAuthorizationsController],
  providers: [CustomerAuthorizationsService, CustomerAuthorizationsRepository],
  exports: [CustomerAuthorizationsService],
})
export class CustomerAuthorizationsModule {}
