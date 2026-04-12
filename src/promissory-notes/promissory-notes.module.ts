import { Module } from '@nestjs/common';
import { PromissoryNotesController } from './promissory-notes.controller.js';
import { PromissoryNotesService } from './promissory-notes.service.js';
import { PromissoryNotesRepository } from './promissory-notes.repository.js';
import { DocuSealService } from './docuseal.service.js';
import { ParametersModule } from '../parameters/parameters.module.js';

@Module({
  imports: [ParametersModule],
  controllers: [PromissoryNotesController],
  providers: [
    PromissoryNotesService,
    PromissoryNotesRepository,
    DocuSealService,
  ],
  exports: [PromissoryNotesService],
})
export class PromissoryNotesModule {}
