import { Module } from '@nestjs/common';
import { ParametersController } from './parameters.controller.js';
import { ParametersService } from './parameters.service.js';
import { ParametersRepository } from './parameters.repository.js';

@Module({
  controllers: [ParametersController],
  providers: [ParametersService, ParametersRepository],
  exports: [ParametersService, ParametersRepository],
})
export class ParametersModule {}
