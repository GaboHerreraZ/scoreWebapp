import { Module } from '@nestjs/common';
import { UserCompaniesController } from './user-companies.controller.js';
import { UserCompaniesService } from './user-companies.service.js';
import { UserCompaniesRepository } from './user-companies.repository.js';

@Module({
  controllers: [UserCompaniesController],
  providers: [UserCompaniesService, UserCompaniesRepository],
  exports: [UserCompaniesService],
})
export class UserCompaniesModule {}
