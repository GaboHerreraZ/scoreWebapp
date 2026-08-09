import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { CustomersRepository } from './customers.repository.js';
import { ParametersModule } from '../parameters/parameters.module.js';

@Module({
  imports: [ParametersModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
  exports: [CustomersService],
})
export class CustomersModule {}
