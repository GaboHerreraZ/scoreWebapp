import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { CompaniesRepository } from './companies.repository.js';
import { EInvoicingModule } from '../e-invoicing/e-invoicing.module.js';

@Module({
  imports: [EInvoicingModule],
  controllers: [CompaniesController],
  providers: [CompaniesService, CompaniesRepository],
  exports: [CompaniesService, CompaniesRepository],
})
export class CompaniesModule {}
