import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { CustomersRepository } from './customers.repository.js';
import { ParametersModule } from '../parameters/parameters.module.js';
import { CustomerAuthorizationsModule } from '../customer-authorizations/customer-authorizations.module.js';

@Module({
  // CustomerAuthorizations: el detalle del cliente expone el estado de la
  // autorización del titular y el enlace a su PDF firmado.
  imports: [ParametersModule, CustomerAuthorizationsModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
  exports: [CustomersService],
})
export class CustomersModule {}
